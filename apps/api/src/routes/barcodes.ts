import { Router } from "express";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { id } from "@az/shared";
import { actor, requirePermission as can } from "../middleware/auth.js";
import { assert, audit, transaction, db } from "../lib/db.js";

// Numeric Code 128 values use compact Code Set C, making small retail labels readable.
export const internalBarcode = () =>
  `20${String(randomInt(0, 10_000_000_000)).padStart(10, "0")}`;
export const labelRequest = z
  .object({
    items: z
      .array(
        z.object({ variantId: id, quantity: z.number().int().min(1).max(500) }),
      )
      .min(1)
      .max(100),
  })
  .refine(
    (v) => v.items.reduce((sum, i) => sum + i.quantity, 0) <= 500,
    "Maximum 500 labels per batch",
  )
  .refine(
    (v) => new Set(v.items.map((i) => i.variantId)).size === v.items.length,
    "Duplicate variants",
  );
export const barcodes = Router();
barcodes.get(
  "/receipts/:id/items",
  can("purchases.view"),
  async (req, res, next) => {
    try {
      const receipt = await db.purchaseReceipt.findUnique({
        where: { id: id.parse(req.params.id) },
        include: {
          items: {
            include: {
              purchaseItem: {
                include: {
                  variant: {
                    include: {
                      product: {
                        select: { id: true, nameAr: true, status: true },
                      },
                      balances: { select: { quantity: true } },
                    },
                  },
                },
              },
            },
          },
        },
      });
      assert(receipt, "NOT_FOUND", "Purchase receipt not found", 404);
      const products = new Map<
          string,
          { id: string; nameAr: string; variants: unknown[] }
        >(),
        quantities: Record<string, number> = {};
      for (const item of receipt.items) {
        const v = item.purchaseItem.variant;
        if (
          !v.active ||
          v.product.status !== "ACTIVE" ||
          item.returned === item.quantity
        )
          continue;
        let product = products.get(v.product.id);
        if (!product) {
          product = {
            id: v.product.id,
            nameAr: v.product.nameAr,
            variants: [],
          };
          products.set(product.id, product);
        }
        product.variants.push({
          id: v.id,
          sku: v.sku,
          barcode: v.barcode,
          price: v.price.toFixed(2),
          active: v.active,
          options: v.options,
          balances: v.balances,
        });
        quantities[v.id] = item.quantity - item.returned;
      }
      res.json({ data: { products: [...products.values()], quantities } });
    } catch (e) {
      next(e);
    }
  },
);
barcodes.post("/print-labels", can("products.view"), async (req, res, next) => {
  try {
    const input = labelRequest.parse(req.body);
    const data = await transaction(async (tx) => {
      const variants = await tx.productVariant.findMany({
        where: { id: { in: input.items.map((i) => i.variantId) } },
        include: { product: { select: { nameAr: true, status: true } } },
      });
      assert(
        variants.length === input.items.length &&
          variants.every((v) => v.active && v.product.status === "ACTIVE"),
        "LABEL_VARIANT_UNAVAILABLE",
        "Some selected variants are inactive or unavailable",
        400,
      );
      const settings = (
        await tx.systemSetting.findUnique({ where: { key: "store" } })
      )?.value as Record<string, unknown> | undefined;
      const lines = input.items.map((i) => {
        const v = variants.find((v) => v.id === i.variantId)!;
        return {
          variantId: v.id,
          name: v.product.nameAr,
          sku: v.sku,
          barcode: v.barcode,
          options: v.options,
          price: v.price.toFixed(2),
          quantity: i.quantity,
        };
      });
      const jobId = crypto.randomUUID();
      await audit(tx, actor(req).id, "BARCODE_LABELS_PREPARE", jobId, {
        items: input.items,
        totalLabels: input.items.reduce((s, i) => s + i.quantity, 0),
      });
      return {
        jobId,
        storeName: String(settings?.name ?? "A&Z Girls Fashion"),
        currency: String(settings?.currency ?? "EGP"),
        items: lines,
      };
    });
    res.json({ data });
  } catch (error) {
    next(error);
  }
});
