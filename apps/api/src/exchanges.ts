import { Router } from "express";
import { z } from "zod";
import { checkoutSchema, paymentSchema, id } from "@az/shared";
import { actor, requirePermission as can } from "./auth.js";
import { db, json, assert, audit } from "./db.js";
import { once, activeShift } from "./operations.js";
import { quoteSale } from "./sale-pricing.js";
import { checkout } from "./sale-checkout.js";
import { quoteReturn, refund, returnSchema } from "./sale-returns.js";
import { D } from "./money.js";
export const netExchangeSchema = z.object({
  returned: returnSchema,
  replacement: checkoutSchema
    .omit({ payments: true })
    .extend({ payments: z.array(paymentSchema).max(4).default([]) }),
});
export const exchanges = Router();
function safe(value: unknown, financial: boolean) {
  const result = json(value);
  function scrub(v: any) {
    if (!v || typeof v !== "object") return;
    for (const key of Object.keys(v)) {
      if (
        key === "passwordHash" ||
        (!financial && ["cost", "unitCost", "inventoryCost"].includes(key))
      )
        delete v[key];
      else scrub(v[key]);
    }
  }
  scrub(result);
  return result;
}
exchanges.post(
  "/sales/:id/exchanges/quote",
  can("sales.refund"),
  can("sales.create"),
  async (req, res, next) => {
    try {
      const saleId = id.parse(req.params.id),
        input = netExchangeSchema.parse(req.body);
      const result = await db.$transaction(
        async (tx) => {
          const old = await quoteReturn(tx, saleId, input.returned),
            replacement = await quoteSale(tx, actor(req), input.replacement);
          return {
            returnTotal: old.total.toFixed(2),
            replacementTotal: replacement.sum.total.toFixed(2),
            difference: replacement.sum.total.minus(old.total).toFixed(2),
          };
        },
        { isolationLevel: "RepeatableRead" },
      );
      res.json({ data: result });
    } catch (e) {
      next(e);
    }
  },
);
exchanges.post(
  "/sales/:id/exchanges/net",
  can("sales.refund"),
  can("sales.create"),
  async (req, res, next) => {
    try {
      const saleId = id.parse(req.params.id),
        input = netExchangeSchema.parse(req.body);
      assert(
        input.returned.shiftId === input.replacement.shiftId,
        "EXCHANGE_SHIFT",
        "Use the same processing shift for the entire exchange",
        400,
      );
      const result = await once(
        actor(req),
        req.get("Idempotency-Key"),
        `net-exchange:${saleId}`,
        input,
        async (tx) => {
          await activeShift(tx, input.replacement.shiftId, actor(req));
          const price = await quoteSale(tx, actor(req), input.replacement);
          const returned = await refund(
            tx,
            actor(req),
            saleId,
            input.returned,
            { exchangeTotal: price.sum.total },
          );
          assert(
            price.sum.total.gt(returned.total) ||
              input.replacement.payments.every((p) => D(p.amount).eq(0)),
            "EXCHANGE_NO_PAYMENT",
            "No extra tender is required for a same-value or lower-value exchange",
            400,
          );
          const replacement = await checkout(
            tx,
            actor(req),
            input.replacement,
            { exchangeCredit: returned.creditAmount },
          );
          const exchange = await tx.exchange.create({
            data: {
              originalSaleId: saleId,
              returnId: returned.id,
              replacementSaleId: replacement.id,
              difference: replacement.total.minus(returned.total),
              createdBy: actor(req).id,
            },
          });
          await audit(tx, actor(req).id, "NET_EXCHANGE", exchange.id, {
            saleId,
            returnId: returned.id,
            replacementSaleId: replacement.id,
            difference: exchange.difference.toFixed(2),
          });
          return { ...exchange, returned, replacement };
        },
      );
      res.status(201).json({
        data: safe(result, actor(req).permissions.includes("reports.profit")),
      });
    } catch (e) {
      next(e);
    }
  },
);
exchanges.get("/exchanges/:id", can("sales.refund"), async (req, res, next) => {
  try {
    const exchange = await db.exchange.findUnique({
      where: { id: id.parse(req.params.id) },
      include: {
        return: { include: { items: { include: { saleItem: true } } } },
        replacement: { include: { items: true, payments: true } },
      },
    });
    assert(exchange, "NOT_FOUND", "Exchange not found", 404);
    const originalSale = await db.sale.findUniqueOrThrow({
      where: { id: exchange.originalSaleId },
      include: { items: true },
    });
    res.json({
      data: safe(
        { ...exchange, returned: { ...exchange.return, originalSale } },
        actor(req).permissions.includes("reports.profit"),
      ),
    });
  } catch (e) {
    next(e);
  }
});
