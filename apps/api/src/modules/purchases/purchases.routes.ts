import { Router } from "express";
import { z } from "zod";
import { id, money } from "@az/shared";
import { db, assert, audit, transaction } from "../../db.js";
import { actor, requirePermission as can } from "../../auth.js";
import { once, receive, receiveSchema } from "../../operations.js";
import { route, uuid, page } from "../http/support.js";

export const purchasesRouter = Router();

purchasesRouter.get(
  "/purchases",
  can("purchases.view", "purchases.preview"),
  route(async (req, res) =>
    res.json({
      data: await db.purchaseOrder.findMany({
        include: { supplier: true, items: true, receipts: true },
        orderBy: { createdAt: "desc" },
        ...page(req.query),
      }),
    }),
  ),
);

purchasesRouter.post(
  "/purchases",
  can("purchases.create"),
  route(async (req, res) => {
    const input = z
      .object({
        supplierId: id,
        locationId: id,
        items: z
          .array(
            z.object({
              variantId: id,
              quantity: z.number().int().positive(),
              unitCost: money,
              salePrice: money,
              minStock: z.coerce.number().int().nonnegative().optional(),
            }),
          )
          .min(1)
          .max(200),
      })
      .parse(req.body);
    const p = await transaction(async (tx) => {
      // Extract salePrice and minStock from items before inserting (not DB columns on PurchaseItem)
      const itemsForCreate = input.items.map(
        ({ salePrice: _sp, minStock: _ms, ...item }) => item,
      );
      const p = await tx.purchaseOrder.create({
        data: {
          supplierId: input.supplierId,
          locationId: input.locationId,
          createdBy: actor(req).id,
          items: { create: itemsForCreate },
        },
        include: { items: true },
      });
      // Update variant sale prices and dynamic minStock where provided
      for (const item of input.items) {
        const updateData: Record<string, any> = {};
        if (item.salePrice !== undefined) updateData.price = item.salePrice;
        if (item.minStock !== undefined) updateData.minStock = item.minStock;
        if (Object.keys(updateData).length > 0) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: updateData,
          });
        }
      }
      await audit(tx, actor(req).id, "PURCHASE_CREATE", p.id);
      return p;
    });
    res.status(201).json({ data: p });
  }),
);

purchasesRouter.post(
  "/purchases/:id/approve",
  can("purchases.receive"),
  route(async (req, res) => {
    const purchaseId = uuid(req.params.id);
    await transaction(async (tx) => {
      const p = await tx.purchaseOrder.updateMany({
        where: { id: purchaseId, status: "DRAFT" },
        data: { status: "APPROVED" },
      });
      assert(p.count === 1, "PURCHASE_STATUS", "Purchase is not draft");
      await audit(tx, actor(req).id, "PURCHASE_APPROVE", purchaseId);
    });
    res.json({ data: { ok: true } });
  }),
);

purchasesRouter.post(
  "/purchases/:id/receive",
  can("purchases.receive"),
  route(async (req, res) => {
    const purchaseId = uuid(req.params.id),
      input = receiveSchema.parse(req.body);
    res.json({
      data: await once(
        actor(req),
        req.get("Idempotency-Key"),
        `receive:${purchaseId}`,
        input,
        (tx) => receive(tx, actor(req), purchaseId, input),
      ),
    });
  }),
);
