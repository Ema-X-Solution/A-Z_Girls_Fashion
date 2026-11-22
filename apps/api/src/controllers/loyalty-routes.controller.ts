import type { RequestHandler } from "express";
import { z } from "zod";
import { id } from "@az/shared";
import { actor } from "../middleware/auth.js";
import { db, assert, audit, transaction } from "../lib/db.js";
import { loyaltySettings, loyaltySettingsSchema, loyaltyBalance } from "../services/loyalty.js";

export const handleGetLoyaltySettings: RequestHandler = async (_req, res, next) => {
    try {
      res.json({ data: await loyaltySettings(db) });
    } catch (e) {
      next(e);
    }
  };

export const handlePatchLoyaltySettings: RequestHandler = async (req, res, next) => {
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
  };

export const handleGetCustomersByIdLoyalty: RequestHandler = async (req, res, next) => {
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
  };
