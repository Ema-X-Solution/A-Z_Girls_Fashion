import { Router } from "express";
import { randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { id, money } from "@az/shared";
import { db, assert, AppError, audit, json, transaction, type Tx } from "../lib/db.js";
import { actor, requirePermission as can } from "../middleware/auth.js";
import { internalBarcode } from "./barcodes.js";
import { productImageAsset } from "./product-images.js";
import { route, uuid, page, text, hasCosts } from "../utils/http.js";

export const catalogRouter = Router();

const code = z.string().trim().min(1).max(200).optional();

const variantSchema = z.object({
  sku: code,
  barcode: z
    .string()
    .regex(/^[\x21-\x7E]{4,80}$/)
    .optional(),
  options: z.record(z.string(), z.string().max(100)).default({}),
  price: money.default("0"),
  cost: money.default("0"),
  minStock: z.number().int().nonnegative().default(2),
  reorderQuantity: z.number().int().positive().default(5),
});

const productSchema = z.object({
  nameAr: text,
  nameEn: text.optional(),
  description: z.string().max(5000).default(""),
  sku: code,
  categoryId: id,
  brandId: id.optional(),
  season: text.optional(),
  collection: text.optional(),
  returnRule: z.enum(["STANDARD", "DEFECT_ONLY"]).default("STANDARD"),
  variants: z.array(variantSchema).min(1).max(100),
});

const barcode = internalBarcode;

async function automaticSku(
  tx: Tx,
  type: "product" | "variant",
  reserved = new Set<string>(),
) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const prefix = type === "product" ? "PRD" : "VAR";
    const value = `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomInt(1000, 10000)}`;
    if (reserved.has(value)) continue;
    const exists =
      type === "product"
        ? await tx.product.findUnique({ where: { sku: value }, select: { id: true } })
        : await tx.productVariant.findUnique({ where: { sku: value }, select: { id: true } });
    if (!exists) {
      reserved.add(value);
      return value;
    }
  }
  throw new AppError(503, "SKU_GENERATION", "تعذر إنشاء كود الصنف تلقائيًا");
}

async function automaticBarcode(tx: Tx, reserved = new Set<string>()) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const value = barcode();
    if (reserved.has(value)) continue;
    const exists = await tx.productVariant.findUnique({
      where: { barcode: value },
      select: { id: true },
    });
    if (!exists) {
      reserved.add(value);
      return value;
    }
  }
  throw new AppError(503, "BARCODE_GENERATION", "تعذر إنشاء الباركود تلقائيًا");
}

const safeProduct = (value: any, financial: boolean): any => {
  const out = json(value);
  if (out?.variants)
    for (const v of out.variants)
      if (!financial) {
        delete v.cost;
        for (const b of v.balances ?? []) delete b.averageCost;
      }
  if (!financial) delete out.cost;
  return out;
};

catalogRouter.get(
  "/categories",
  can("products.view"),
  route(async (_req, res) =>
    res.json({
      data: await db.category.findMany({ orderBy: { name: "asc" } }),
    }),
  ),
);

catalogRouter.post(
  "/categories",
  can("products.create"),
  route(async (req, res) => {
    const input = z
      .object({ name: text, parentId: id.optional() })
      .parse(req.body);
    res.status(201).json({ data: await db.category.create({ data: input }) });
  }),
);

catalogRouter.get(
  "/brands",
  can("products.view"),
  route(async (_req, res) => res.json({ data: await db.brand.findMany() })),
);

catalogRouter.post(
  "/brands",
  can("products.create"),
  route(async (req, res) =>
    res.status(201).json({
      data: await db.brand.create({
        data: z.object({ name: text }).parse(req.body),
      }),
    }),
  ),
);

catalogRouter.get(
  "/products",
  can("products.view"),
  route(async (req, res) => {
    const q = z.string().max(200).default("").parse(req.query.q),
      where: Prisma.ProductWhereInput = {
        status: { not: "ARCHIVED" },
        ...(q
          ? {
              OR: [
                { nameAr: { contains: q, mode: "insensitive" } },
                { sku: { contains: q, mode: "insensitive" } },
                { variants: { some: { barcode: q } } },
              ],
            }
          : {}),
      };
    const [data, total] = await Promise.all([
      db.product.findMany({
        where,
        include: { category: true, variants: { include: { balances: { include: { location: true } } } } },        orderBy: { createdAt: "desc" },
        ...page(req.query),
      }),
      db.product.count({ where }),
    ]);
    res.json({ data: data.map((p) => safeProduct(p, hasCosts(req))), total });
  }),
);

catalogRouter.post(
  "/products",
  can("products.create"),
  route(async (req, res) => {
    const { imageDataUrl, ...input } = productSchema
      .extend({
        imageDataUrl: z.string().max(200000).optional(),
      })
      .parse(req.body);
    const image =
      imageDataUrl === undefined
        ? undefined
        : productImageAsset(imageDataUrl, actor(req).id);
    const product = await transaction(async (tx) => {
      if (image)
        await tx.brandAsset.createMany({ data: [image], skipDuplicates: true });
      const variantSkus = new Set<string>(),
        variantBarcodes = new Set<string>(),
        variants = [];
      for (const variant of input.variants) {
        const sku = variant.sku ?? (await automaticSku(tx, "variant", variantSkus));
        variants.push({
          ...variant,
          sku,
          barcode: variant.barcode ?? (await automaticBarcode(tx, variantBarcodes)),
        });
      }
      const p = await tx.product.create({
        data: {
          ...input,
          sku: input.sku ?? (await automaticSku(tx, "product")),
          imageUrl: image ? `/api/brand-assets/${image.id}` : null,
          createdBy: actor(req).id,
          variants: {
            create: variants,
          },
        },
        include: { variants: true },
      });
      await audit(tx, actor(req).id, "PRODUCT_CREATE", p.id);
      return p;
    });
    res.status(201).json({ data: safeProduct(product, hasCosts(req)) });
  }),
);

catalogRouter.get(
  "/products/:id",
  can("products.view"),
  route(async (req, res) => {
    const p = await db.product.findUnique({
      where: { id: uuid(req.params.id) },
      include: { category: true, variants: { include: { balances: { include: { location: true } } } } },    });
    assert(p, "NOT_FOUND", "Product not found", 404);
    res.json({ data: safeProduct(p, hasCosts(req)) });
  }),
);

catalogRouter.patch(
  "/products/:id",
  can("products.update"),
  route(async (req, res) => {
    const input = productSchema
        .omit({ variants: true })
        .partial()
        .parse(req.body),
      productId = uuid(req.params.id);
    res.json({
      data: await transaction(async (tx) => {
        const p = await tx.product.update({
          where: { id: productId },
          data: input,
        });
        await audit(tx, actor(req).id, "PRODUCT_UPDATE", productId);
        return p;
      }),
    });
  }),
);

catalogRouter.post(
  "/products/:id/archive",
  can("products.archive"),
  route(async (req, res) => {
    const productId = uuid(req.params.id);
    await transaction(async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: { status: "ARCHIVED" },
      });
      await audit(tx, actor(req).id, "PRODUCT_ARCHIVE", productId);
    });
    res.json({ data: { ok: true } });
  }),
);

catalogRouter.post(
  "/products/:id/variants",
  can("products.create"),
  route(async (req, res) => {
    const input = variantSchema.parse(req.body);
    const v = await transaction(async (tx) => {
      const v = await tx.productVariant.create({
        data: {
          ...input,
          sku: input.sku ?? (await automaticSku(tx, "variant")),
          barcode: input.barcode ?? (await automaticBarcode(tx)),
          productId: uuid(req.params.id),
        },
      });
      await audit(tx, actor(req).id, "VARIANT_CREATE", v.id);
      return v;
    });
    res.status(201).json({ data: safeProduct(v, hasCosts(req)) });
  }),
);

catalogRouter.patch(
  "/variants/:id",
  can("products.change_price"),
  route(async (req, res) => {
    const input = variantSchema
        .partial()
        .extend({
          active: z.boolean().optional(),
          minStock: z.coerce.number().int().nonnegative().optional(),
        })
        .parse(req.body),
      variantId = uuid(req.params.id);
    res.json({
      data: safeProduct(
        await transaction(async (tx) => {
          const before = await tx.productVariant.findUniqueOrThrow({
            where: { id: variantId },
          });
          const v = await tx.productVariant.update({
            where: { id: variantId },
            data: input,
          });
          await audit(tx, actor(req).id, "VARIANT_UPDATE", variantId, {
            oldBarcode: before.barcode,
            newBarcode: v.barcode,
          });
          return v;
        }),
        hasCosts(req),
      ),
    });
  }),
);

catalogRouter.get(
  "/barcodes/:code/lookup",
  can("products.view", "pos.access"),
  route(async (req, res) => {
    const code = z.string().max(80).parse(req.params.code),
      v = await db.productVariant.findUnique({
        where: { barcode: code },
        include: {
          product: { select: { nameAr: true, status: true } },
          balances: { select: { locationId: true, quantity: true } },
        },
      });
    assert(
      v && v.active && v.product.status === "ACTIVE",
      "UNKNOWN_BARCODE",
      "Barcode not found or inactive",
      404,
    );
    res.json({ data: safeProduct(v, hasCosts(req)) });
  }),
);

catalogRouter.post("/barcodes/generate", can("products.create"), (_req, res) =>
  res.json({ data: { barcode: barcode() } }),
);
