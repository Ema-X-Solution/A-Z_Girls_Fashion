import { Router } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import { actor, requirePermission as can } from "./auth.js";
import { assert, audit, transaction } from "./db.js";

export function productImageAsset(dataUrl: string, createdBy: string) {
  const match =
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      dataUrl,
    );
  assert(match, "INVALID_IMAGE", "Use PNG, JPEG or WebP", 400);
  const data = Buffer.from(match[2]!, "base64"),
    mime = match[1]!;
  const detected = data
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "image/png"
    : data[0] === 255 && data[1] === 216 && data[2] === 255
      ? "image/jpeg"
      : data.subarray(0, 4).toString() === "RIFF" &&
          data.subarray(8, 12).toString() === "WEBP"
        ? "image/webp"
        : "";
  assert(
    data.length >= 32 && data.length <= 140000 && mime === detected,
    "INVALID_IMAGE",
    "Invalid image or size exceeds 140 KB",
    400,
  );
  return {
    id: createHash("sha256").update(data).digest("hex"),
    mime,
    data: new Uint8Array(data),
    createdBy: createdBy,
  };
}

export const productImages = Router();
productImages.post(
  "/products/:id/image",
  can("products.update"),
  async (req, res, next) => {
    try {
      const productId = z.string().uuid().parse(req.params.id);
      const { dataUrl } = z
        .object({ dataUrl: z.string().max(200000).nullable() })
        .parse(req.body);
      const asset =
        dataUrl === null
          ? undefined
          : productImageAsset(dataUrl, actor(req).id);
      const imageUrl = asset ? `/api/brand-assets/${asset.id}` : null;
      await transaction(async (tx) => {
        const product = await tx.product.findUnique({
          where: { id: productId },
        });
        assert(
          product && product.status !== "ARCHIVED",
          "NOT_FOUND",
          "Product not found",
          404,
        );
        if (asset)
          await tx.brandAsset.createMany({
            data: [asset],
            skipDuplicates: true,
          });
        await tx.product.update({
          where: { id: productId },
          data: { imageUrl },
        });
        await audit(tx, actor(req).id, "PRODUCT_IMAGE_UPDATED", productId, {
          imageUrl,
        });
      });
      res.json({ data: { imageUrl } });
    } catch (e) {
      next(e);
    }
  },
);
