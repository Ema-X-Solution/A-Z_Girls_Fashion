import { Router } from "express";
import { z } from "zod";
import { id, money } from "@az/shared";
import { actor, requirePermission as can, type Actor } from "./auth.js";
import { db, assert, audit, json, type Tx, transaction } from "./db.js";
import { once, stock } from "./operations.js";
import { D, round } from "./money.js";
export const stockDocumentSchema = z
  .object({
    type: z.enum(["TRANSFER", "DAMAGE", "ADJUSTMENT"]),
    sourceId: id,
    destinationId: id.optional(),
    reason: z.string().trim().min(3).max(1000),
    items: z
      .array(
        z.object({
          variantId: id,
          quantity: z
            .number()
            .int()
            .min(-100000)
            .max(100000)
            .refine((v) => v !== 0),
          cost: money.optional(),
        }),
      )
      .min(1)
      .max(200),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.type === "TRANSFER"
        ? !v.destinationId || v.destinationId === v.sourceId
        : !!v.destinationId
    )
      ctx.addIssue({
        code: "custom",
        message: "Choose distinct source/destination for transfers only",
      });
    if (
      v.items.some(
        (i) =>
          (v.type !== "ADJUSTMENT" && i.quantity < 0) ||
          (i.cost !== undefined && (v.type !== "ADJUSTMENT" || i.quantity < 0)),
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Positive quantities required; cost is only allowed on positive adjustments",
      });
    if (new Set(v.items.map((i) => i.variantId)).size !== v.items.length)
      ctx.addIssue({ code: "custom", message: "Duplicate variant" });
  });
export async function postStockDocument(
  tx: Tx,
  user: Actor,
  input: z.infer<typeof stockDocumentSchema>,
) {
  input = stockDocumentSchema.parse(input);
  const locationIds = [
    input.sourceId,
    ...(input.destinationId ? [input.destinationId] : []),
  ].sort();
  assert(
    (await tx.stockLocation.count({ where: { id: { in: locationIds } } })) ===
      locationIds.length,
    "NOT_FOUND",
    "Stock location not found",
    404,
  );
  const variants = await tx.productVariant.findMany({
    where: { id: { in: input.items.map((i) => i.variantId) } },
    include: { product: { select: { nameAr: true } } },
  });
  assert(
    variants.length === input.items.length,
    "INVALID_PRODUCT",
    "Some variants do not exist",
    400,
  );
  // Lock every affected balance in one order before reading valuation or posting either leg.
  for (const item of [...input.items].sort((a, b) =>
    a.variantId.localeCompare(b.variantId),
  ))
    for (const locationId of locationIds) {
      await tx.stockBalance.upsert({
        where: {
          variantId_locationId: { variantId: item.variantId, locationId },
        },
        create: { variantId: item.variantId, locationId },
        update: {},
      });
      await tx.$queryRaw`SELECT "quantity" FROM "StockBalance" WHERE "variantId"=${item.variantId}::uuid AND "locationId"=${locationId}::uuid FOR UPDATE`;
    }
  const documentId = crypto.randomUUID(),
    items = [];
  let totalCost = D(0);
  for (const line of [...input.items].sort((a, b) =>
    a.variantId.localeCompare(b.variantId),
  )) {
    const variant = variants.find((v) => v.id === line.variantId)!;
    const balance = await tx.stockBalance.findUniqueOrThrow({
      where: {
        variantId_locationId: {
          variantId: line.variantId,
          locationId: input.sourceId,
        },
      },
    });
    const cost = line.cost !== undefined ? D(line.cost) : balance.averageCost;
    const quantity =
      input.type === "ADJUSTMENT" ? line.quantity : -line.quantity;
    await stock(tx, user, {
      variantId: line.variantId,
      locationId: input.sourceId,
      quantity,
      cost: quantity > 0 ? cost : undefined,
      type: input.type === "TRANSFER" ? "TRANSFER_OUT" : input.type,
      reference: documentId,
      reason: input.reason,
    });
    if (input.destinationId)
      await stock(tx, user, {
        variantId: line.variantId,
        locationId: input.destinationId,
        quantity: line.quantity,
        cost,
        type: "TRANSFER_IN",
        reference: documentId,
        reason: input.reason,
      });
    totalCost = totalCost.plus(cost.mul(line.quantity));
    items.push({
      variantId: line.variantId,
      name: variant.product.nameAr,
      sku: variant.sku,
      quantity: line.quantity,
      unitCost: cost,
    });
  }
  const document = await tx.stockDocument.create({
    data: {
      id: documentId,
      type: input.type,
      sourceId: input.sourceId,
      destinationId: input.destinationId,
      reason: input.reason,
      totalCost: round(totalCost),
      createdBy: user.id,
      items: { create: items },
    },
    include: { items: true },
  });
  await audit(tx, user.id, `STOCK_${input.type}`, document.id, {
    sourceId: input.sourceId,
    destinationId: input.destinationId ?? null,
  });
  return document;
}
function safe(document: any, costs: boolean) {
  const out = json(document);
  if (!costs) {
    delete out.totalCost;
    for (const item of out.items) delete item.unitCost;
  }
  return out;
}
export const stockDocuments = Router();
stockDocuments.get(
  "/inventory/documents",
  can("inventory.view"),
  async (req, res, next) => {
    try {
      const skip = z.coerce
          .number()
          .int()
          .min(0)
          .default(0)
          .parse(req.query.offset),
        type = z
          .enum(["TRANSFER", "DAMAGE", "ADJUSTMENT"])
          .optional()
          .parse(req.query.type);
      const [rows, total] = await db.$transaction([
        db.stockDocument.findMany({
          where: { type },
          include: { items: true },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip,
          take: 30,
        }),
        db.stockDocument.count({ where: { type } }),
      ]);
      res.json({
        data: rows.map((row) =>
          safe(row, actor(req).permissions.includes("reports.profit")),
        ),
        total,
      });
    } catch (e) {
      next(e);
    }
  },
);
stockDocuments.post(
  "/inventory/documents",
  can("inventory.adjust"),
  async (req, res, next) => {
    try {
      const input = stockDocumentSchema.parse(req.body);
      const result = await once(
        actor(req),
        req.get("Idempotency-Key"),
        "stock-document",
        input,
        (tx) => postStockDocument(tx, actor(req), input),
      );
      res.status(201).json({
        data: safe(result, actor(req).permissions.includes("reports.profit")),
      });
    } catch (e) {
      next(e);
    }
  },
);
stockDocuments.post(
  "/inventory/locations",
  can("inventory.adjust"),
  async (req, res, next) => {
    try {
      const input = z
        .object({ name: z.string().trim().min(2).max(200), branchId: id })
        .strict()
        .parse(req.body);
      const result = await transaction(async (tx) => {
        assert(
          await tx.branch.findUnique({ where: { id: input.branchId } }),
          "NOT_FOUND",
          "Branch not found",
          404,
        );
        const location = await tx.stockLocation.create({ data: input });
        await audit(tx, actor(req).id, "STOCK_LOCATION", location.id, {});
        return location;
      });
      res.status(201).json({ data: result });
    } catch (e) {
      next(e);
    }
  },
);
