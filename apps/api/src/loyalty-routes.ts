import { Router } from "express";
import { z } from "zod";
import { id } from "@az/shared";
import { actor, requirePermission as can } from "./auth.js";
import { db, assert, audit, transaction } from "./db.js";
import {
  loyaltySettings,
  loyaltySettingsSchema,
  loyaltyBalance,
} from "./loyalty.js";
export const loyaltyRoutes = Router();
loyaltyRoutes.get(
  "/loyalty/settings",
  can("pos.access", "customers.manage", "settings.manage"),
  async (_req, res, next) => {
    try {
      res.json({ data: await loyaltySettings(db) });
    } catch (e) {
      next(e);
    }
  },
);
loyaltyRoutes.patch(
  "/loyalty/settings",
  can("settings.manage"),
  async (req, res, next) => {
    try {
      const input = loyaltySettingsSchema.parse(req.body);
      await transaction(async (tx) => {
        await tx.systemSetting.upsert({
          where: { key: "loyalty" },
          create: { key: "loyalty", value: input },
          update: { value: input },
        });
        await audit(tx, actor(req).id, "LOYALTY_SETTINGS", "loyalty", input);
      });
      res.json({ data: input });
    } catch (e) {
      next(e);
    }
  },
);
loyaltyRoutes.get(
  "/customers/:id/loyalty",
  can("pos.access", "customers.manage"),
  async (req, res, next) => {
    try {
      const customerId = id.parse(req.params.id);
      assert(
        await db.customer.findUnique({ where: { id: customerId } }),
        "NOT_FOUND",
        "Customer not found",
        404,
      );
      const offset = z.coerce
        .number()
        .int()
        .min(0)
        .default(0)
        .parse(req.query.offset);
      const details = actor(req).permissions.includes("customers.manage");
      const data = await db.$transaction(
        async (tx) => ({
          ...(await loyaltyBalance(tx, customerId)),
          entries: details
            ? await tx.loyaltyEntry.findMany({
                where: { customerId },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                skip: offset,
                take: 30,
              })
            : [],
          total: details
            ? await tx.loyaltyEntry.count({ where: { customerId } })
            : 0,
        }),
        { isolationLevel: "RepeatableRead" },
      );
      res.json({ data });
    } catch (e) {
      next(e);
    }
  },
);
