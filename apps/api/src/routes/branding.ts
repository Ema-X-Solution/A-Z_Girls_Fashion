import { Router } from "express";
import { z } from "zod";
import { createHash } from "node:crypto";
import { actor, requirePermission as can } from "../middleware/auth.js";
import { db, assert, audit, transaction } from "../lib/db.js";
export const publicBranding = Router(),
  branding = Router();
publicBranding.get("/branding", async (_req, res, next) => {
  try {
    const store = await db.systemSetting.findUnique({
      where: { key: "store" },
    });
    res.json({
      data: { logoUrl: (store?.value as any)?.logoUrl ?? "/brand/az-logo.jpg" },
    });
  } catch (e) {
    next(e);
  }
});
publicBranding.get("/brand-assets/:id", async (req, res, next) => {
  try {
    const id = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(req.params.id);
    const asset = await db.brandAsset.findUnique({ where: { id } });
    assert(asset, "NOT_FOUND", "Logo not found", 404);
    res
      .set({
        "Content-Type": asset.mime,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      })
      .send(Buffer.from(asset.data));
  } catch (e) {
    next(e);
  }
});
branding.post(
  "/settings/logo",
  can("settings.manage"),
  async (req, res, next) => {
    try {
      const { dataUrl } = z
        .object({ dataUrl: z.string().max(200000) })
        .parse(req.body);
      const matched =
        /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
          dataUrl,
        );
      assert(matched, "INVALID_LOGO", "Use PNG, JPEG or WebP", 400);
      const mime = matched[1]!,
        data = Buffer.from(matched[2]!, "base64");
      assert(
        data.length >= 32 && data.length <= 140000,
        "INVALID_LOGO",
        "Logo exceeds size limit",
        400,
      );
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
      assert(mime === detected, "INVALID_LOGO", "Invalid image format", 400);
      const id = createHash("sha256").update(data).digest("hex"),
        logoUrl = `/api/brand-assets/${id}`;
      await transaction(async (tx) => {
        await tx.brandAsset.createMany({
          data: [{ id, mime, data, createdBy: actor(req).id }],
          skipDuplicates: true,
        });
        const store = await tx.systemSetting.findUniqueOrThrow({
          where: { key: "store" },
        });
        await tx.systemSetting.update({
          where: { key: "store" },
          data: { value: { ...(store.value as any), logoUrl } },
        });
        await audit(tx, actor(req).id, "LOGO_UPDATED", id);
      });
      res.json({ data: { logoUrl } });
    } catch (e) {
      next(e);
    }
  },
);
