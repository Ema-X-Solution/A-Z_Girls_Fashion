import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { id, money } from "@az/shared";
import { actor, requirePermission as can } from "../middleware/auth.js";
import { db, assert, audit, transaction } from "../lib/db.js";
import { D } from "../utils/money.js";
export const promotions = Router();
const schema = z
  .object({
    name: z.string().trim().min(3).max(200),
    type: z.enum(["PERCENT", "BUY_X_GET_Y"]),
    productIds: z.array(id).max(200).default([]),
    percent: money.default("0").refine((v) => D(v).lte(100)),
    buyQuantity: z.number().int().min(1).max(50).default(2),
    getQuantity: z.number().int().min(1).max(50).default(1),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    active: z.boolean().default(false),
  })
  .refine(
    (v) => new Date(v.endsAt) > new Date(v.startsAt),
    "End must be after start",
  )
  .refine(
    (v) => v.type !== "PERCENT" || D(v.percent).gt(0),
    "Percentage required",
  );
promotions.get(
  "/promotions",
  can("promotions.manage"),
  async (_req, res, next) => {
    try {
      res.json({
        data: await db.promotion.findMany({
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
      });
    } catch (e) {
      next(e);
    }
  },
);
const savePromotion: RequestHandler = async (req, res, next) => {
  const method = req.method.toLowerCase();
  try {
    const input = schema.parse(req.body),
      promotionId =
        method === "post" ? crypto.randomUUID() : id.parse(req.params.id);
    const maximumPercent =
      input.type === "PERCENT"
        ? D(input.percent)
        : D(input.getQuantity)
            .mul(100)
            .div(input.buyQuantity + input.getQuantity);
    assert(
      !input.active || maximumPercent.lte(actor(req).discountLimit),
      "PROMOTION_LIMIT",
      "خصم العرض أكبر من حد صلاحيتك. يلزم مستخدم بحد خصم أعلى لتفعيل العرض.",
      403,
    );
    const result = await transaction(async (tx) => {
      assert(
        new Set(input.productIds).size === input.productIds.length,
        "DUPLICATE_PRODUCT",
        "Duplicate products",
        400,
      );
      assert(
        (await tx.product.count({
          where: { id: { in: input.productIds } },
        })) === input.productIds.length,
        "INVALID_PRODUCT",
        "Unknown product",
        400,
      );
      const data = {
        ...input,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
      };
      const row =
        method === "post"
          ? await tx.promotion.create({
              data: { ...data, id: promotionId, createdBy: actor(req).id },
            })
          : await tx.promotion.update({ where: { id: promotionId }, data });
      await audit(
        tx,
        actor(req).id,
        method === "post" ? "PROMOTION_CREATED" : "PROMOTION_UPDATED",
        row.id,
        input,
      );
      return row;
    });
    res.status(method === "post" ? 201 : 200).json({ data: result });
  } catch (e) {
    next(e);
  }
};
promotions.post("/promotions", can("promotions.manage"), savePromotion);
promotions.patch("/promotions/:id", can("promotions.manage"), savePromotion);
