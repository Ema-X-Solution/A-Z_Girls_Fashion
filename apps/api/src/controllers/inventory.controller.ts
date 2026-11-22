import type { RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { id, money } from "@az/shared";
import { db, assert, audit, json, transaction } from "../lib/db.js";
import { actor } from "../middleware/auth.js";
import { once, stock } from "../services/operations.js";
import { postStockDocument } from "../routes/stock-documents.js";
import { route, uuid, page, hasCosts } from "../utils/http.js";

export const handleGetInventory: RequestHandler = route(async (req, res) => {
    const locationId =
      typeof req.query.locationId === "string" && req.query.locationId
        ? uuid(req.query.locationId)
        : undefined;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
    const where: Prisma.StockBalanceWhereInput = {
      ...(locationId ? { locationId } : {}),
      ...(q
        ? {
            OR: [
              { variant: { product: { nameAr: { contains: q, mode: "insensitive" } } } },
              { variant: { sku: { contains: q, mode: "insensitive" } } },
              { variant: { barcode: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      db.stockBalance.findMany({
        where,
        include: {
          variant: {
            include: {
              product: { select: { id: true, nameAr: true, sku: true } },
            },
          },
          location: { include: { branch: { select: { name: true } } } },
        },
        orderBy: { variantId: "asc" },
        ...page(req.query),
      }),
      db.stockBalance.count({ where }),
    ]);
    res.json({
      data: data.map((b) => {
        const out = json(b);
        if (!hasCosts(req)) {
          delete out.averageCost;
          delete out.variant.cost;
        }
        return out;
      }),
      total,
    });
  });

export const handleGetInventoryMovements: RequestHandler = route(async (req, res) => {
    const data = await db.stockMovement.findMany({
      include: {
        variant: {
          select: {
            barcode: true,
            sku: true,
            product: { select: { nameAr: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      ...page(req.query),
    });
    res.json({
      data: data.map((m) => {
        const out = json(m);
        if (!hasCosts(req)) delete out.unitCost;
        return out;
      }),
    });
  });

export const handlePostInventoryAdjustments: RequestHandler = route(async (req, res) => {
    const input = z
      .object({
        variantId: id,
        locationId: id,
        quantity: z
          .number()
          .int()
          .min(-100000)
          .max(100000)
          .refine((v) => v !== 0),
        reason: z.string().min(3).max(1000),
        cost: money.optional(),
      })
      .parse(req.body);
    res.json({
      data: await once(
        actor(req),
        req.get("Idempotency-Key"),
        "adjust",
        input,
        async (tx) => {
          const document = await postStockDocument(tx, actor(req), {
            type: "ADJUSTMENT",
            sourceId: input.locationId,
            reason: input.reason,
            items: [
              {
                variantId: input.variantId,
                quantity: input.quantity,
                ...(input.cost ? { cost: input.cost } : {}),
              },
            ],
          });
          return { reference: document.id };
        },
      ),
    });
  });

export const handleGetInventoryStockCounts: RequestHandler = route(async (req, res) =>
    res.json({
      data: await db.stockCount.findMany({
        include: { items: true },
        orderBy: { cutoff: "desc" },
        ...page(req.query),
      }),
    }),
  );

export const handlePostInventoryStockCounts: RequestHandler = route(async (req, res) => {
    const { locationId, mode } = z
      .object({
        locationId: id,
        mode: z.enum(["CUTOFF", "CONTINUOUS"]).default("CUTOFF"),
      })
      .parse(req.body);
    res.status(201).json({
      data: await transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "StockLocation" WHERE id=${locationId}::uuid FOR UPDATE`;
        const openCounts = await tx.stockCount.findMany({
          where: { locationId, status: "OPEN" },
          select: { mode: true },
        });
        assert(
          !openCounts.some((c) => c.mode === "CONTINUOUS") &&
            (mode !== "CONTINUOUS" || openCounts.length === 0),
          "COUNT_OPEN",
          "أغلق جلسات الجرد المفتوحة في المخزن قبل الجرد المستمر",
        );
        const balances = await tx.stockBalance.findMany({
          where: { locationId },
        });
        const count = await tx.stockCount.create({
          data: {
            locationId,
            mode,
            createdBy: actor(req).id,
            items: {
              create: balances.map((b) => ({
                variantId: b.variantId,
                expected: b.quantity,
              })),
            },
          },
        });
        await audit(tx, actor(req).id, "COUNT_OPEN", count.id);
        return count;
      }),
    });
  });

export const handlePatchInventoryStockCountsById: RequestHandler = route(async (req, res) => {
    const countId = uuid(req.params.id),
      input = z
        .object({
          items: z.array(
            z.object({ variantId: id, actual: z.number().int().nonnegative() }),
          ),
        })
        .parse(req.body);
    await transaction(async (tx) => {
      const count = await tx.stockCount.findUniqueOrThrow({
        where: { id: countId },
      });
      assert(count.status === "OPEN", "COUNT_CLOSED", "Count already approved");
      for (const item of [...input.items].sort((a, b) =>
        a.variantId.localeCompare(b.variantId),
      )) {
        let expected: number | undefined;
        if (count.mode === "CONTINUOUS") {
          await tx.$queryRaw`SELECT quantity FROM "StockBalance" WHERE "variantId"=${item.variantId}::uuid AND "locationId"=${count.locationId}::uuid FOR UPDATE`;
          expected = (
            await tx.stockBalance.findUniqueOrThrow({
              where: {
                variantId_locationId: {
                  variantId: item.variantId,
                  locationId: count.locationId,
                },
              },
            })
          ).quantity;
        }
        await tx.stockCountItem.update({
          where: { countId_variantId: { countId, variantId: item.variantId } },
          data: {
            actual: item.actual,
            countedAt: new Date(),
            ...(expected !== undefined ? { expected } : {}),
          },
        });
      }
    });
    res.json({ data: { ok: true } });
  });

export const handlePostInventoryStockCountsByIdApprove: RequestHandler = route(async (req, res) => {
    const countId = uuid(req.params.id);
    await transaction(async (tx) => {
      const count = await tx.stockCount.findUniqueOrThrow({
        where: { id: countId },
        include: { items: true },
      });
      assert(
        count.status === "OPEN" && count.items.every((i) => i.actual !== null),
        "COUNT_INVALID",
        "Count closed or incomplete",
      );
      const movements = await tx.stockMovement.count({
        where: {
          locationId: count.locationId,
          createdAt: { gte: count.cutoff },
        },
      });
      assert(
        movements === 0 || count.mode === "CONTINUOUS",
        "COUNT_MOVED",
        "Stock moved after cutoff; recount using a new session",
      );
      for (const item of count.items.sort((a, b) =>
        a.variantId.localeCompare(b.variantId),
      )) {
        const diff = item.actual! - item.expected;
        if (count.mode === "CONTINUOUS")
          assert(item.countedAt, "COUNT_INVALID", "أدخل كمية حديثة لكل صنف");
        if (diff)
          await stock(tx, actor(req), {
            variantId: item.variantId,
            locationId: count.locationId,
            quantity: diff,
            type: "COUNT",
            reference: countId,
            reason: "Approved physical count",
          });
      }
      await tx.stockCount.update({
        where: { id: countId },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedBy: actor(req).id,
        },
      });
      await audit(tx, actor(req).id, "COUNT_APPROVE", countId);
    });
    res.json({ data: { ok: true } });
  });
