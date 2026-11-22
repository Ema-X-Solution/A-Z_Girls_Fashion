import type { RequestHandler } from "express";
import { z } from "zod";
import { id } from "@az/shared";
import { actor } from "../middleware/auth.js";
import { db, assert, audit } from "../lib/db.js";
import { once, stock } from "../services/operations.js";
import { round } from "../utils/money.js";

export const handlePostInventoryStockCountsByIdCancel: RequestHandler = async (req, res, next) => {
    try {
      const countId = id.parse(req.params.id);
      await once(
        actor(req),
        req.get("Idempotency-Key"),
        `count-cancel:${countId}`,
        {},
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "StockCount" WHERE id=${countId}::uuid FOR UPDATE`;
          const count = await tx.stockCount.findUnique({
            where: { id: countId },
          });
          assert(
            count?.status === "OPEN",
            "COUNT_CLOSED",
            "الجلسة مغلقة أو غير موجودة",
          );
          await tx.stockCount.update({
            where: { id: countId },
            data: { status: "CANCELLED" },
          });
          await audit(tx, actor(req).id, "COUNT_CANCEL", countId);
          return { ok: true };
        },
      );
      res.json({ data: { ok: true } });
    } catch (e) {
      next(e);
    }
  };

const qty = z.number().int().positive().max(100000),
  reason = z.string().trim().min(3).max(1000);

const visible = (v: any, profit: boolean): any =>
  Array.isArray(v)
    ? v.map((x) => visible(x, profit))
    : v &&
        typeof v === "object" &&
        !(v instanceof Date) &&
        typeof v.toFixed !== "function"
      ? Object.fromEntries(
          Object.entries(v)
            .filter(([k]) => profit || !["unitCost", "totalCost"].includes(k))
            .map(([k, x]) => [k, visible(x, profit)]),
        )
      : v;

async function countPage(req: any, model: "shipment" | "stockHold") {
  const skip = z.coerce
    .number()
    .int()
    .min(0)
    .default(0)
    .parse(req.query.offset);
  const result =
    model === "shipment"
      ? await db.$transaction([
          db.shipment.findMany({
            skip,
            take: 30,
            orderBy: { createdAt: "desc" },
            include: { items: true },
          }),
          db.shipment.count(),
        ])
      : await db.$transaction([
          db.stockHold.findMany({
            skip,
            take: 30,
            orderBy: { createdAt: "desc" },
          }),
          db.stockHold.count(),
        ]);
  return {
    data: visible(result[0], actor(req).permissions.includes("reports.profit")),
    total: result[1],
  };
}

export const handleGetInventoryShipments: RequestHandler = async (req, res, next) => {
    try {
      res.json(await countPage(req, "shipment"));
    } catch (e) {
      next(e);
    }
  };

export const handlePostInventoryShipments: RequestHandler = async (req, res, next) => {
    try {
      const input = z
        .object({
          sourceId: id,
          destinationId: id,
          reason,
          items: z
            .array(z.object({ variantId: id, quantity: qty }))
            .min(1)
            .max(100),
        })
        .parse(req.body);
      assert(
        input.sourceId !== input.destinationId,
        "SAME_LOCATION",
        "اختار مخزنًا مختلفًا",
        400,
      );
      assert(
        new Set(input.items.map((i) => i.variantId)).size ===
          input.items.length,
        "DUPLICATE_ITEM",
        "الصنف متكرر",
        400,
      );
      const result = await once(
        actor(req),
        req.get("Idempotency-Key"),
        "shipment-create",
        input,
        async (tx) => {
          assert(
            (await tx.stockLocation.count({
              where: { id: { in: [input.sourceId, input.destinationId] } },
            })) === 2,
            "LOCATION",
            "المخزن غير موجود",
            404,
          );
          const shipment = await tx.shipment.create({
            data: {
              sourceId: input.sourceId,
              destinationId: input.destinationId,
              reason: input.reason,
              createdBy: actor(req).id,
            },
          });
          for (const line of [...input.items].sort((a, b) =>
            a.variantId.localeCompare(b.variantId),
          )) {
            const cost = await stock(tx, actor(req), {
              variantId: line.variantId,
              locationId: input.sourceId,
              quantity: -line.quantity,
              type: "SHIPMENT_OUT",
              reference: shipment.id,
              reason: input.reason,
            });
            await tx.shipmentItem.create({
              data: { shipmentId: shipment.id, ...line, unitCost: cost },
            });
          }
          await audit(tx, actor(req).id, "SHIPMENT_SEND", shipment.id);
          return tx.shipment.findUniqueOrThrow({
            where: { id: shipment.id },
            include: { items: true },
          });
        },
      );
      res
        .status(201)
        .json({
          data: visible(
            result,
            actor(req).permissions.includes("reports.profit"),
          ),
        });
    } catch (e) {
      next(e);
    }
  };

export const handlePostInventoryShipmentsByIdReceive: RequestHandler = async (req, res, next) => {
    try {
      const shipmentId = id.parse(req.params.id),
        input = z
          .object({
            items: z
              .array(z.object({ itemId: id, quantity: qty }))
              .min(1)
              .max(100),
          })
          .parse(req.body);
      assert(
        new Set(input.items.map((i) => i.itemId)).size === input.items.length,
        "DUPLICATE_ITEM",
        "الصنف متكرر",
        400,
      );
      const result = await once(
        actor(req),
        req.get("Idempotency-Key"),
        `shipment-receive:${shipmentId}`,
        input,
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Shipment" WHERE id=${shipmentId}::uuid FOR UPDATE`;
          const shipment = await tx.shipment.findUnique({
            where: { id: shipmentId },
            include: { items: true },
          });
          assert(
            shipment && shipment.status !== "RECEIVED",
            "SHIPMENT_STATUS",
            "الشحنة مستلمة أو غير موجودة",
          );
          const lines = input.items
            .map((i) => {
              const item = shipment.items.find((x) => x.id === i.itemId);
              assert(
                item && i.quantity <= item.quantity - item.received,
                "RECEIVE_QUANTITY",
                "الاستلام أكبر من المتبقي",
              );
              return { ...i, item };
            })
            .sort((a, b) => a.item.variantId.localeCompare(b.item.variantId));
          for (const line of lines) {
            await stock(tx, actor(req), {
              variantId: line.item.variantId,
              locationId: shipment.destinationId,
              quantity: line.quantity,
              cost: line.item.unitCost,
              type: "SHIPMENT_IN",
              reference: shipment.id,
              reason: shipment.reason,
            });
            await tx.shipmentItem.update({
              where: { id: line.item.id },
              data: { received: { increment: line.quantity } },
            });
          }
          const remaining = await tx.shipmentItem.findMany({
            where: { shipmentId },
          });
          const updated = await tx.shipment.update({
            where: { id: shipmentId },
            data: {
              status: remaining.every((i) => i.received === i.quantity)
                ? "RECEIVED"
                : "PARTIAL",
            },
            include: { items: true },
          });
          await audit(tx, actor(req).id, "SHIPMENT_RECEIVE", shipmentId, input);
          return updated;
        },
      );
      res.json({
        data: visible(
          result,
          actor(req).permissions.includes("reports.profit"),
        ),
      });
    } catch (e) {
      next(e);
    }
  };

export const handleGetInventoryHolds: RequestHandler = async (req, res, next) => {
    try {
      res.json(await countPage(req, "stockHold"));
    } catch (e) {
      next(e);
    }
  };

export const handlePostInventoryHolds: RequestHandler = async (req, res, next) => {
    try {
      const input = z
        .object({ locationId: id, variantId: id, quantity: qty, reason })
        .parse(req.body);
      const result = await once(
        actor(req),
        req.get("Idempotency-Key"),
        "stock-hold",
        input,
        async (tx) => {
          const holdId = crypto.randomUUID();
          const cost = await stock(tx, actor(req), {
            variantId: input.variantId,
            locationId: input.locationId,
            quantity: -input.quantity,
            type: "QUARANTINE_OUT",
            reference: holdId,
            reason: input.reason,
          });
          const hold = await tx.stockHold.create({
            data: {
              id: holdId,
              ...input,
              unitCost: cost,
              createdBy: actor(req).id,
            },
          });
          await audit(tx, actor(req).id, "QUARANTINE_CREATE", hold.id);
          return hold;
        },
      );
      res
        .status(201)
        .json({
          data: visible(
            result,
            actor(req).permissions.includes("reports.profit"),
          ),
        });
    } catch (e) {
      next(e);
    }
  };

export const handlePostInventoryHoldsByIdResolve: RequestHandler = async (req, res, next) => {
    try {
      const holdId = id.parse(req.params.id),
        input = z
          .object({
            action: z.enum(["RELEASE", "DISPOSE"]),
            quantity: qty,
            reason,
          })
          .parse(req.body);
      const result = await once(
        actor(req),
        req.get("Idempotency-Key"),
        `stock-hold-resolve:${holdId}`,
        input,
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "StockHold" WHERE id=${holdId}::uuid FOR UPDATE`;
          const hold = await tx.stockHold.findUnique({ where: { id: holdId } });
          assert(hold, "NOT_FOUND", "الحجر غير موجود", 404);
          assert(
            input.quantity <= hold.quantity - hold.released - hold.disposed,
            "HOLD_QUANTITY",
            "الكمية أكبر من المتبقي",
          );
          if (input.action === "RELEASE")
            await stock(tx, actor(req), {
              variantId: hold.variantId,
              locationId: hold.locationId,
              quantity: input.quantity,
              cost: hold.unitCost,
              type: "QUARANTINE_RELEASE",
              reference: hold.id,
              reason: input.reason,
            });
          else {
            const variant = await tx.productVariant.findUniqueOrThrow({
              where: { id: hold.variantId },
              include: { product: true },
            });
            await tx.stockDocument.create({
              data: {
                type: "DAMAGE",
                sourceId: hold.locationId,
                reason: `حجر ${hold.id}: ${input.reason}`,
                createdBy: actor(req).id,
                totalCost: round(hold.unitCost.mul(input.quantity)),
                items: {
                  create: {
                    variantId: hold.variantId,
                    name: variant.product.nameAr,
                    sku: variant.sku,
                    quantity: input.quantity,
                    unitCost: hold.unitCost,
                  },
                },
              },
            });
          }
          const updated = await tx.stockHold.update({
            where: { id: holdId },
            data:
              input.action === "RELEASE"
                ? { released: { increment: input.quantity } }
                : { disposed: { increment: input.quantity } },
          });
          await audit(tx, actor(req).id, "QUARANTINE_RESOLVE", holdId, input);
          return updated;
        },
      );
      res.json({
        data: visible(
          result,
          actor(req).permissions.includes("reports.profit"),
        ),
      });
    } catch (e) {
      next(e);
    }
  };
