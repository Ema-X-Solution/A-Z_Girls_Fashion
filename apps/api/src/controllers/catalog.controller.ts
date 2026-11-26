import { pagination, paginated,usesPagination,listResult } from "../utils/pagination.js";
import type { RequestHandler } from "express";
import { randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { id, money } from "@az/shared";
import { db, assert, AppError, audit, json, transaction, type Tx } from "../lib/db.js";
import { actor } from "../middleware/auth.js";
import { internalBarcode } from "../routes/barcodes.js";
import { productImageAsset } from "../routes/product-images.js";
import { route, uuid, page, text, hasCosts } from "../utils/http.js";
import { updateVariantSchema } from "../validators/variant-update.validation.js";

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
  primarySupplierId: z.union([id, z.literal("")]).nullable().optional().transform((value) => value === "" ? null : value),
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

export const handleGetCategories: RequestHandler = route(async(req,res)=>{
 const archived=z.enum(["1","true"]).optional().parse(req.query.archived);
 const where=archived?{archivedAt:{not:null}}:{archivedAt:null};
 const [data,total]=await Promise.all([db.category.findMany({where,orderBy:archived?[{archivedAt:"desc"},{id:"desc"}]:[{name:"asc"},{id:"asc"}],...(usesPagination(req.query)?page(req.query):{})}),db.category.count({where})]);res.json(listResult(req.query,data,total));
});

export const handlePostCategories: RequestHandler = route(async (req, res) => {
    const input = z
      .object({ name: text, parentId: id.optional() })
      .parse(req.body);
    const duplicate = await db.category.findFirst({
      where: { name: input.name, parentId: input.parentId ?? null },
    });
    assert(
      !duplicate,
      "CATEGORY_NAME_EXISTS",
      "يوجد قسم بنفس الاسم بالفعل. اختر اسمًا مختلفًا.",
      409,
    );
    res.status(201).json({ data: await db.category.create({ data: input }) });
  });

export const handlePatchCategoriesById: RequestHandler = route(async (req, res) => {
    const { name } = z.object({ name: text }).parse(req.body),
      category = await db.category.findUnique({
        where: { id: uuid(req.params.id) },
      });
    assert(category, "CATEGORY_NOT_FOUND", "القسم غير موجود.", 404);
    const duplicate = await db.category.findFirst({
      where: {
        name,
        parentId: category.parentId ?? null,
        id: { not: category.id },
      },
    });
    assert(
      !duplicate,
      "CATEGORY_NAME_EXISTS",
      "يوجد قسم بنفس الاسم بالفعل. اختر اسمًا مختلفًا.",
      409,
    );
    await transaction(async (tx) => {
      await tx.category.update({ where: { id: category.id }, data: { name } });
      await audit(tx, actor(req).id, "CATEGORY_RENAME", category.id, { name });
    });
    res.json({ data: { ok: true } });
  });

export const handlePostCategoriesByIdRemove: RequestHandler = route(
  async (req, res) => {
    const category = await db.category.findUnique({
      where: { id: uuid(req.params.id) },
      include: { _count: { select: { products: true, children: true } } },
    });
    assert(category, "CATEGORY_NOT_FOUND", "القسم غير موجود.", 404);
    if (category._count.products > 0 || category._count.children > 0) {
      // Anything with products (and their sales history) or sub-categories is
      // archived and hidden, never truly deleted.
      assert(
        !category.archivedAt,
        "CATEGORY_ALREADY_ARCHIVED",
        "القسم مؤرشف بالفعل.",
        409,
      );
      await transaction(async (tx) => {
        await tx.category.update({
          where: { id: category.id },
          data: { archivedAt: new Date() },
        });
        await audit(tx, actor(req).id, "CATEGORY_ARCHIVE", category.id);
      });
      res.json({
        data: {
          archived: true,
          message:
            "القسم مرتبط بمنتجات أو أقسام فرعية، فتمت أرشفته وإخفاؤه بدلًا من حذفه حفاظًا على سجلات المبيعات.",
        },
      });
      return;
    }
    await transaction(async (tx) => {
      await tx.category.delete({ where: { id: category.id } });
      await audit(tx, actor(req).id, "CATEGORY_DELETE", category.id);
    });
    res.json({
      data: { deleted: true, message: "تم حذف القسم الفارغ نهائيًا." },
    });
  },
);

export const handlePostCategoriesByIdRestore: RequestHandler = route(
  async (req, res) => {
    const category = await db.category.findUnique({
      where: { id: uuid(req.params.id) },
    });
    assert(category, "CATEGORY_NOT_FOUND", "القسم غير موجود.", 404);
    assert(
      category.archivedAt,
      "CATEGORY_NOT_ARCHIVED",
      "القسم غير مؤرشف.",
      409,
    );
    await transaction(async (tx) => {
      await tx.category.update({
        where: { id: category.id },
        data: { archivedAt: null },
      });
      await audit(tx, actor(req).id, "CATEGORY_RESTORE", category.id);
    });
    res.json({
      data: { restored: true, message: "تمت استعادة القسم من الأرشيف." },
    });
  },
);

export const handleGetBrands: RequestHandler = route(async (_req, res) => res.json({ data: await db.brand.findMany() }));

export const handlePostBrands: RequestHandler = route(async (req, res) =>
    res.status(201).json({
      data: await db.brand.create({
        data: z.object({ name: text }).parse(req.body),
      }),
    }),
  );

export async function buildProductWhere(query: Record<string, unknown>): Promise<Prisma.ProductWhereInput> {
  const q = z.string().max(200).default("").parse(query.q),
    supplierId = id.optional().parse(query.supplierId),
    stock = z.enum(["in", "low", "out"]).optional().parse(query.stock),
    locationId = id.optional().parse(query.locationId),
    archived = z.enum(["1", "true"]).optional().parse(query.archived),
    where: Prisma.ProductWhereInput = {
      status: archived ? "ARCHIVED" : { not: "ARCHIVED" },
      ...(supplierId ? { primarySupplierId: supplierId } : {}),
      // Warehouse filter: a stock row in that warehouse is enough, zero
      // quantity included (Amr, 2026-11-24); "all warehouses" adds nothing.
      ...(locationId
        ? { variants: { some: { balances: { some: { locationId } } } } }
        : {}),
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
  // Stock status: a variant is low when its on-hand total across locations is
  // at or below its own minStock; a product is out only when nothing is on
  // hand anywhere. Compared in SQL because Prisma cannot compare across models.
  if (stock) {
    const rows = await db.$queryRaw<
      { productId: string; qty: number; minStock: number }[]
    >`
      SELECT v."productId" AS "productId",
             COALESCE(SUM(b.quantity), 0)::int AS qty,
             v."minStock" AS "minStock"
      FROM "ProductVariant" v
      LEFT JOIN "StockBalance" b ON b."variantId" = v.id
      GROUP BY v.id, v."productId", v."minStock"`;
    const totals = new Map<string, { qty: number; low: boolean }>();
    for (const row of rows) {
      const total = totals.get(row.productId) ?? { qty: 0, low: false };
      total.qty += row.qty;
      if (row.qty <= row.minStock) total.low = true;
      totals.set(row.productId, total);
    }
    where.id = {
      in: [...totals]
        .filter(([, total]) =>
          stock === "out"
            ? total.qty <= 0
            : stock === "low"
              ? total.qty > 0 && total.low
              : total.qty > 0 && !total.low,
        )
        .map(([productId]) => productId),
    };
  }
  return where;
}

export const handleGetProducts: RequestHandler = route(async (req, res) => {
  const countOnly = z.enum(["1", "true"]).optional().parse(req.query.countOnly),
    where = await buildProductWhere(req.query);
  // Tab badges ask for the matching count only: skip the row read entirely.
  if (countOnly) {
    res.json({ total: await db.product.count({ where }) });
    return;
  }
  // Keep legacy offset/limit callers unchanged until their screens migrate.
  const current =
    req.query.page !== undefined || req.query.pageSize !== undefined
      ? pagination(req.query)
      : null;
  const window = current ?? page(req.query);
  const reads = [
    db.product.findMany({
      where,
      include: {
        category: true,
        primarySupplier: { select: { code: true } },
        variants: { include: { balances: { include: { location: true } } } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(current ? { skip: current.skip, take: current.take } : window),
    }),
    db.product.count({ where }),
  ] as const;
  const [data, total] = current
    ? await db.$transaction([...reads], {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      })
    : await Promise.all(reads);
  const safe = data.map((p) => safeProduct(p, hasCosts(req)));
  res.json(current ? paginated(safe, total, current) : { data: safe, total });
});

export const handlePostProducts: RequestHandler = route(async (req, res) => {
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
      if (input.primarySupplierId) assert(await tx.supplier.findFirst({ where: { id: input.primarySupplierId, active: true }, select: { id: true } }), "SUPPLIER_UNAVAILABLE", "المورد غير موجود أو غير نشط.", 400);
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
  });

export const handleGetProductsById: RequestHandler = route(async (req, res) => {
    const p = await db.product.findUnique({
      where: { id: uuid(req.params.id) },
      include: { category: true, variants: { include: { balances: { include: { location: true } } } } },    });
    assert(p, "NOT_FOUND", "Product not found", 404);
    res.json({ data: safeProduct(p, hasCosts(req)) });
  });

export const handlePatchProductsById: RequestHandler = route(async (req, res) => {
    const input = productSchema
        .omit({ variants: true })
        .partial()
        .parse(req.body),
      productId = uuid(req.params.id);
    res.json({
      data: await transaction(async (tx) => {
        if (input.primarySupplierId) assert(await tx.supplier.findFirst({ where: { id: input.primarySupplierId, active: true }, select: { id: true } }), "SUPPLIER_UNAVAILABLE", "المورد غير موجود أو غير نشط.", 400);
        const p = await tx.product.update({
          where: { id: productId },
          data: input,
        });
        await audit(tx, actor(req).id, "PRODUCT_UPDATE", productId);
        return p;
      }),
    });
  });

export const handlePostProductsByIdArchive: RequestHandler = route(async (req, res) => {
    const productId = uuid(req.params.id);
    await transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        include: { variants: { include: { balances: true } } },
      });
      assert(product, "PRODUCT_NOT_FOUND", "المنتج غير موجود.", 404);
      assert(product.status !== "ARCHIVED", "PRODUCT_ALREADY_ARCHIVED", "المنتج مؤرشف بالفعل.");
      const variantIds = product.variants.map((variant) => variant.id);
      const [shipments, holds] = await Promise.all([
        tx.shipmentItem.findMany({ where: { variantId: { in: variantIds } } }),
        tx.stockHold.findMany({ where: { variantId: { in: variantIds } } }),
      ]);
      assert(
        product.variants.every((variant) =>
          variant.balances.every((balance) => balance.quantity === 0),
        ) &&
          shipments.every((item) => item.quantity === item.received) &&
          holds.every((hold) => hold.quantity === hold.released + hold.disposed),
        "PRODUCT_HAS_STOCK",
        "لا يمكن أرشفة المنتج: يجب أن تكون كمية كل مقاس ولون في كل المخازن صفرًا، ولا توجد كميات قيد التحويل أو محجورة.",
      );
      await tx.product.update({
        where: { id: productId },
        data: { status: "ARCHIVED" },
      });
      await audit(tx, actor(req).id, "PRODUCT_ARCHIVE", productId);
    });
    res.json({ data: { ok: true, message: "تمت أرشفة المنتج مع الاحتفاظ بسجلاته السابقة." } });
  });

export const handlePostProductsByIdRestore: RequestHandler = route(async (req, res) => {
    const productId = uuid(req.params.id);
    await transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      assert(product, "PRODUCT_NOT_FOUND", "المنتج غير موجود.", 404);
      assert(product.status === "ARCHIVED", "PRODUCT_NOT_ARCHIVED", "المنتج غير مؤرشف.");
      await tx.product.update({
        where: { id: productId },
        data: { status: "ACTIVE" },
      });
      await audit(tx, actor(req).id, "PRODUCT_RESTORE", productId);
    });
    res.json({ data: { restored: true, message: "تمت استعادة المنتج من الأرشيف." } });
  });

export const handlePostProductsByIdVariants: RequestHandler = route(async (req, res) => {
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
  });

export const handlePatchVariantsById: RequestHandler = route(async (req, res) => {
    const input = updateVariantSchema.parse(req.body),
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
            ...(input.price !== undefined
              ? { price: { before: before.price.toFixed(2), after: v.price.toFixed(2) } }
              : {}),
            ...(input.minStock !== undefined
              ? { minStock: { before: before.minStock, after: v.minStock } }
              : {}),
          });
          return v;
        }),
        hasCosts(req),
      ),
    });
  });

export const handleGetBarcodesByCodeLookup: RequestHandler = route(async (req, res) => {
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
  });

export const handlePostBarcodesGenerate: RequestHandler = (_req, res) =>
  res.json({ data: { barcode: barcode() } });
