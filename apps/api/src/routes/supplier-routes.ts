import { Router } from "express";
import { z } from "zod";
import { id, money } from "@az/shared";
import { db, assert, transaction, audit, json } from "../lib/db.js";
import { actor, requirePermission as can } from "../middleware/auth.js";
import { once } from "../services/operations.js";
import {
  supplierStatement,
  purchaseReturnSchema,
  returnPurchase,
  supplierList,
  supplierPaymentSchema,
  paySupplier,
  lockSupplier,
} from "../services/supplier-accounts.js";
export const supplierRoutes = Router();
function publicDocument(value: any, financial: boolean): any {
  if (financial) return value;
  const result = json(value);
  function scrub(node: any) {
    if (!node || typeof node !== "object") return;
    for (const key of Object.keys(node)) {
      if (["inventoryCost", "averageCost", "cost"].includes(key))
        delete node[key];
      else scrub(node[key]);
    }
  }
  scrub(result);
  return result;
}
const pagination = (q: any) => ({
  take: z.coerce.number().int().min(1).max(100).default(30).parse(q.limit),
  skip: z.coerce.number().int().min(0).default(0).parse(q.offset),
});
supplierRoutes.get(
  "/suppliers",
  can("suppliers.manage", "purchases.view"),
  async (req, res, next) => {
    try {
      const q = z.string().max(200).default("").parse(req.query.q);
      res.json(
        await db.$transaction(
          (tx) =>
            supplierList(
              tx,
              q,
              pagination(req.query),
              actor(req).permissions.includes("suppliers.manage"),
            ),
          { isolationLevel: "RepeatableRead" },
        ),
      );
    } catch (e) {
      next(e);
    }
  },
);
supplierRoutes.post(
  "/suppliers",
  can("suppliers.manage"),
  async (req, res, next) => {
    try {
      const input = z
        .object({
          name: z.string().trim().min(1).max(200),
          phone: z.string().max(40).default(""),
          email: z.string().email().optional(),
          address: z.string().max(1000).default(""),
          notes: z.string().max(2000).default(""),
          openingBalance: money.default("0"),
        })
        .parse(req.body);
      res.status(201).json({
        data: await transaction(async (tx) => {
          const s = await tx.supplier.create({ data: input });
          await audit(tx, actor(req).id, "SUPPLIER_CREATE", s.id, {
            openingBalance: input.openingBalance,
          });
          return s;
        }),
      });
    } catch (e) {
      next(e);
    }
  },
);
supplierRoutes.patch(
  "/suppliers/:id",
  can("suppliers.manage"),
  async (req, res, next) => {
    try {
      const supplierId = id.parse(req.params.id);
      const input = z
        .object({
          name: z.string().trim().min(1).max(200),
          phone: z.string().max(40).default(""),
          email: z.string().email().nullable().optional(),
          address: z.string().max(1000).default(""),
          notes: z.string().max(2000).default(""),
        })
        .parse(req.body);
      res.json({
        data: await transaction(async (tx) => {
          await lockSupplier(tx, supplierId);
          const supplier = await tx.supplier.update({
            where: { id: supplierId },
            data: { ...input, email: input.email || null },
          });
          await audit(tx, actor(req).id, "SUPPLIER_UPDATE", supplierId, {
            name: supplier.name,
            phone: supplier.phone,
            address: supplier.address,
          });
          return supplier;
        }),
      });
    } catch (e) {
      next(e);
    }
  },
);
supplierRoutes.post(
  "/suppliers/:id/payments",
  can("suppliers.manage"),
  async (req, res, next) => {
    try {
      const supplierId = id.parse(req.params.id),
        input = supplierPaymentSchema.parse(req.body);
      res.status(201).json({
        data: await once(
          actor(req),
          req.get("Idempotency-Key"),
          `supplier-payment:${supplierId}`,
          input,
          (tx) => paySupplier(tx, actor(req), supplierId, input),
        ),
      });
    } catch (e) {
      next(e);
    }
  },
);
supplierRoutes.get(
  "/suppliers/:id/statement",
  can("suppliers.manage"),
  async (req, res, next) => {
    try {
      const supplierId = id.parse(req.params.id),
        p = pagination(req.query);
      res.json({
        data: await db.$transaction(
          (tx) => supplierStatement(tx, supplierId, p.take, p.skip),
          { isolationLevel: "RepeatableRead" },
        ),
      });
    } catch (e) {
      next(e);
    }
  },
);
supplierRoutes.get(
  "/suppliers/:id/invoices",
  can("suppliers.manage"),
  async (req, res, next) => {
    try {
      const supplierId = id.parse(req.params.id);
      res.json({
        data: await db.supplierInvoice.findMany({
          where: { supplierId },
          include: {
            returns: { select: { total: true } },
            receipt: { select: { purchaseId: true } },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          ...pagination(req.query),
        }),
        total: await db.supplierInvoice.count({ where: { supplierId } }),
      });
    } catch (e) {
      next(e);
    }
  },
);
supplierRoutes.get(
  "/supplier-invoices/:id",
  can("suppliers.manage"),
  async (req, res, next) => {
    try {
      const invoice = await db.supplierInvoice.findUnique({
        where: { id: id.parse(req.params.id) },
        include: {
          supplier: true,
          returns: { include: { items: true } },
          receipt: {
            include: {
              purchase: { include: { location: true } },
              items: {
                include: {
                  purchaseItem: {
                    include: {
                      variant: {
                        include: { product: { select: { nameAr: true } } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      assert(invoice, "NOT_FOUND", "Supplier invoice not found", 404);
      res.json({
        data: publicDocument(
          invoice,
          actor(req).permissions.includes("reports.profit"),
        ),
      });
    } catch (e) {
      next(e);
    }
  },
);
supplierRoutes.post(
  "/supplier-invoices/:id/returns",
  can("suppliers.manage"),
  can("purchases.receive"),
  async (req, res, next) => {
    try {
      const invoiceId = id.parse(req.params.id),
        input = purchaseReturnSchema.parse(req.body);
      const returned = await once(
        actor(req),
        req.get("Idempotency-Key"),
        `supplier-return:${invoiceId}`,
        input,
        (tx) => returnPurchase(tx, actor(req), invoiceId, input),
      );
      res.json({
        data: publicDocument(
          returned,
          actor(req).permissions.includes("reports.profit"),
        ),
      });
    } catch (e) {
      next(e);
    }
  },
);
supplierRoutes.get(
  "/suppliers/:id/returns",
  can("suppliers.manage"),
  async (req, res, next) => {
    try {
      const supplierId = id.parse(req.params.id);
      res.json({
        data: publicDocument(
          await db.purchaseReturn.findMany({
            where: { supplierId },
            include: { items: true },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            ...pagination(req.query),
          }),
          actor(req).permissions.includes("reports.profit"),
        ),
        total: await db.purchaseReturn.count({ where: { supplierId } }),
      });
    } catch (e) {
      next(e);
    }
  },
);
