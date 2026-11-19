import { Router } from "express";
import { z } from "zod";
import { id, money } from "@az/shared";
import { actor, requirePermission as can } from "./auth.js";
import { assert, audit, transaction } from "./db.js";
import { D } from "./money.js";
export const customerDiscounts = Router();
customerDiscounts.patch(
  "/customers/:id/discount",
  can("settings.manage"),
  async (req, res, next) => {
    try {
      const customerId = id.parse(req.params.id),
        { percent } = z
          .object({ percent: money.refine((v) => D(v).lte(100)) })
          .parse(req.body);
      res.json({
        data: await transaction(async (tx) => {
          assert(
            await tx.customer.findUnique({ where: { id: customerId } }),
            "NOT_FOUND",
            "العميل غير موجود",
            404,
          );
          const result = await tx.customer.update({
            where: { id: customerId },
            data: { discountPercent: percent },
            select: { id: true, discountPercent: true },
          });
          await audit(tx, actor(req).id, "CUSTOMER_DISCOUNT", customerId, {
            percent,
          });
          return result;
        }),
      });
    } catch (e) {
      next(e);
    }
  },
);
