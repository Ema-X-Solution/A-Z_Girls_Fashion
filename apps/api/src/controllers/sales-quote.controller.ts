import type { RequestHandler } from "express";
import { checkoutSchema } from "@az/shared";
import { AppError, db } from "../lib/db.js";
import { actor } from "../middleware/auth.js";
import { quoteSale } from "../services/sale-pricing.js";
import { route } from "../utils/http.js";

export const handlePostSalesQuote: RequestHandler = route(async (req, res) => {
  const input = checkoutSchema.parse(req.body),
    result = await db.$transaction(
      async (tx) => {
        try {
          return {
            priced: await quoteSale(tx, actor(req), input),
            authorizationError: null,
          };
        } catch (error) {
          // A preview may show exact prices while authorization remains blocked.
          // Strict quotes and checkout keep the existing approval checks.
          if (
            req.body.previewOnly !== true ||
            !(error instanceof AppError) ||
            ![
              "DISCOUNT_LIMIT",
              "DISCOUNT_APPROVAL_INVALID",
              "DISCOUNT_APPROVAL_CHANGED",
            ].includes(error.code)
          )
            throw error;
          return {
            priced: await quoteSale(tx, actor(req), input, {
              checkDiscount: false,
            }),
            authorizationError: {
              status: error.status,
              code: error.code,
              message: error.message,
            },
          };
        }
      },
      { isolationLevel: "RepeatableRead" },
    ),
    { priced, authorizationError } = result;
  res.json({
    data: {
      ...priced.sum,
      authorizationError,
      taxMode: priced.taxMode,
      taxRate: priced.taxRate,
      promotion: priced.promotion,
      promotionDiscount: priced.promotionDiscount.toFixed(2),
      customerDiscount: priced.customerDiscount.toFixed(2),
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
});
