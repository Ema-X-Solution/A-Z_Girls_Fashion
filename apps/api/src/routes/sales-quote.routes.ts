import { Router } from "express";
import { checkoutSchema } from "@az/shared";
import { db } from "../lib/db.js";
import { actor, requirePermission as can } from "../middleware/auth.js";
import { quoteSale } from "../services/sale-pricing.js";
import { route } from "../utils/http.js";

export const salesQuoteRouter = Router();

salesQuoteRouter.post(
  "/sales/quote",
  can("sales.create"),
  route(async (req, res) => {
    const input = checkoutSchema.parse(req.body),
      priced = await db.$transaction((tx) => quoteSale(tx, actor(req), input), {
        isolationLevel: "RepeatableRead",
      });
    res.json({
      data: {
        ...priced.sum,
        taxMode: priced.taxMode,
        taxRate: priced.taxRate,
        promotion: priced.promotion,
        automaticDiscount: priced.automaticDiscount.toFixed(2),
        manualDiscount: priced.manualDiscount.toFixed(2),
        loyalty: {
          enabled: priced.loyalty.settings.enabled,
          available: priced.loyalty.available,
          debt: priced.loyalty.debt,
          redeemed: priced.loyalty.points,
          discount: priced.loyalty.discount.toFixed(2),
          earned:
            input.customerId && priced.loyalty.settings.enabled
              ? Math.min(
                  1000000,
                  priced.sum.netBeforeTax
                    .div(priced.loyalty.settings.spendPerPoint)
                    .floor()
                    .toNumber(),
                )
              : 0,
        },
        items: priced.lines.map(({ variant }) => ({
          variantId: variant.id,
          unitPrice: variant.price.toFixed(2),
        })),
      },
    });
  }),
);
