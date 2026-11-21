import express, { type RequestHandler } from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { hash, verify, argon2id } from "argon2";
import { pinoHttp } from "pino-http";
import { randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  checkoutSchema,
  id,
  money,
  permissions,
  defaultReturnPolicy,
} from "@az/shared";
import { db, assert, AppError, audit, json, transaction, type Tx } from "./db.js";
import {
  actor,
  authenticate,
  cookieName,
  cookieOptions,
  digest,
  requirePermission as can,
  token,
} from "./auth.js";
import {
  activeShift,
  checkout,
  once,
  receive,
  receiveSchema,
  refund,
  returnSchema,
  stock,
} from "./operations.js";
import { D } from "./money.js";
import { reports } from "./reports.js";
import { isAllowedOrigin } from "./origins.js";
import { barcodes, internalBarcode } from "./barcodes.js";
import { supplierRoutes } from "./supplier-routes.js";
import { exchanges } from "./exchanges.js";
import { quoteSale } from "./sale-pricing.js";
import { checkoutRecovery } from "./checkout-recovery.js";
import { discountApprovals } from "./discount-approvals.js";
import { promotions } from "./promotions.js";
import { publicBranding, branding } from "./branding.js";
import {
  expenseWorkflow,
  expenseInput,
  createExpense,
} from "./expense-workflow.js";
import { administration } from "./administration.js";
import { sharedCarts } from "./shared-carts.js";
import { customerDiscounts } from "./customer-discounts.js";
import { advancedStock } from "./advanced-stock.js";
import { detailedReports } from "./detailed-reports.js";
import { productImages, productImageAsset } from "./product-images.js";
import { loyaltyRoutes } from "./loyalty-routes.js";
import { stockDocuments, postStockDocument } from "./stock-documents.js";
import {
  customers,
  customerSchema,
  createCustomer,
  searchCustomers,
  lockCustomerPhone,
  matchingPhone,
} from "./customers.js";
import { customerPhoneSchema } from "@az/shared";
const app = express();
app.disable("x-powered-by");
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
app.use(
  helmet(),
  express.json({ limit: "2mb" }),
  cookieParser(),
  pinoHttp({
    redact: [
      "req.headers.cookie",
      "req.headers.authorization",
      "res.headers.set-cookie",
    ],
    autoLogging: process.env.NODE_ENV !== "test",
  }),
);
export const apiRateLimiter = rateLimit({
  windowMs: 60000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
app.use("/api", apiRateLimiter);
app.set("json replacer", (_key: string, value: unknown) =>
  typeof value === "bigint" ? value.toString() : value,
);
const route =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
const uuid = (v: unknown) => id.parse(v);
function page(query: any) {
  return {
    take: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(30)
      .parse(query.limit),
    skip: z.coerce.number().int().min(0).default(0).parse(query.offset),
  };
}
const text = z.string().trim().min(1).max(200);
const code = z.string().trim().min(1).max(200).optional();
const variantSchema = z.object({
  sku: code,
  barcode: z
    .string()
    .regex(/^[\x21-\x7E]{4,80}$/)
    .optional(),
  options: z.record(z.string(), z.string().max(100)).default({}),
  price: money,
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
const hasCosts = (req: express.Request) =>
  actor(req).permissions.includes("reports.profit");
const publicUser = {
  id: true,
  name: true,
  email: true,
  active: true,
  discountLimit: true,
  createdAt: true,
  employeeCode: true,
  roles: { include: { role: { select: { id: true, name: true } } } },
} as const;
app.get(
  "/api/health",
  route(async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: "ok" });
  }),
);
app.post(
  "/api/auth/login",
  rateLimit({
    windowMs: 900000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  route(async (req, res) => {
    assert(isAllowedOrigin(req.get("origin")), "CSRF", "Invalid origin", 403);
    const input = z
      .object({
        email: z
          .string()
          .email()
          .transform((v) => v.toLowerCase()),
        password: z.string().min(1).max(256),
      })
      .parse(req.body);
    const user = await db.user.findUnique({ where: { email: input.email } });
    // A real Argon2 verification also runs for unknown users to reduce account enumeration.
    const dummy =
      "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const correct = await verify(
      user?.passwordHash ?? dummy,
      input.password,
    ).catch(() => false);
    if (
      !user ||
      !user.active ||
      (user.lockedUntil && user.lockedUntil > new Date()) ||
      !correct
    ) {
      if (user)
        await transaction(async (tx) => {
          await tx.user.update({
            where: { id: user.id },
            data: {
              failedAttempts: { increment: 1 },
              lockedUntil:
                user.failedAttempts >= 4
                  ? new Date(Date.now() + 900000)
                  : undefined,
            },
          });
          await audit(tx, user.id, "LOGIN_FAILED", user.id);
        });
      throw new AppError(
        401,
        "INVALID_CREDENTIALS",
        "Invalid credentials or account temporarily locked",
      );
    }
    const raw = token(),
      csrf = token();
    await transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { failedAttempts: 0, lockedUntil: null },
      });
      await tx.session.create({
        data: {
          id: digest(raw),
          csrf,
          userId: user.id,
          expiresAt: new Date(Date.now() + 8 * 3600000),
        },
      });
      await audit(tx, user.id, "LOGIN", user.id);
    });
    res
      .cookie(cookieName, raw, { ...cookieOptions, maxAge: 8 * 3600000 })
      .json({ data: { csrf } });
  }),
);
app.use("/api", publicBranding);
app.use("/api", authenticate);
app.get("/api/auth/me", (req, res) =>
  res.json({ data: { ...actor(req), csrf: req.csrf } }),
);
app.post(
  "/api/auth/logout",
  route(async (req, res) => {
    await db.session.delete({ where: { id: req.sessionId } });
    res.clearCookie(cookieName, cookieOptions).json({ data: { ok: true } });
  }),
);
app.post(
  "/api/auth/refresh",
  route(async (req, res) => {
    const raw = token(),
      csrf = token();
    await transaction(async (tx) => {
      await tx.session.delete({ where: { id: req.sessionId } });
      await tx.session.create({
        data: {
          id: digest(raw),
          userId: actor(req).id,
          csrf,
          expiresAt: new Date(Date.now() + 8 * 3600000),
        },
      });
    });
    res
      .cookie(cookieName, raw, { ...cookieOptions, maxAge: 8 * 3600000 })
      .json({ data: { csrf } });
  }),
);

app.get(
  "/api/users",
  can("users.manage"),
  route(async (req, res) =>
    res.json({
      data: await db.user.findMany({ select: publicUser, ...page(req.query) }),
    }),
  ),
);
app.post(
  "/api/users",
  can("users.manage"),
  route(async (req, res) => {
    const input = z
      .object({
        name: text,
        email: z
          .string()
          .email()
          .transform((v) => v.toLowerCase()),
        password: z.string().min(8).max(256),
        roleIds: z.array(id).min(1),
        discountLimit: money.default("0"),
      })
      .parse(req.body);
    assert(
      D(input.discountLimit).lte(100),
      "INVALID_LIMIT",
      "Discount limit exceeds 100",
      400,
    );
    const roles = await db.role.findMany({
      where: { id: { in: input.roleIds } },
    });
    assert(
      roles.length === new Set(input.roleIds).size,
      "INVALID_ROLE",
      "Some roles do not exist",
      400,
    );
    assert(
      actor(req).roles.includes("OWNER") || roles.every((r) => !r.protected),
      "OWNER_PROTECTED",
      "Only owner may assign protected roles",
      403,
    );
    if (!actor(req).roles.includes("OWNER")) {
      const assigned = await db.rolePermission.findMany({
        where: { roleId: { in: input.roleIds } },
      });
      assert(
        assigned.every((p) =>
          actor(req).permissions.includes(p.permissionKey),
        ) && D(input.discountLimit).lte(actor(req).discountLimit),
        "PRIVILEGE_ESCALATION",
        "Cannot grant privileges above your own",
        403,
      );
    }
    const passwordHash = await hash(input.password, { type: argon2id });
    const user = await transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash,
          discountLimit: input.discountLimit,
          employeeCode: undefined,
          roles: { create: input.roleIds.map((roleId) => ({ roleId })) },
        },
        select: publicUser,
      });
      const updated = await tx.user.update({
        where: { id: u.id },
        data: { employeeCode: u.id.slice(0, 8).toUpperCase() },
        select: publicUser,
      });
      await audit(tx, actor(req).id, "USER_CREATE", updated.id);
      return updated;
    });
    res.status(201).json({ data: user });
  }),
);
app.patch(
  "/api/users/:id/status",
  can("users.manage"),
  route(async (req, res) => {
    const userId = uuid(req.params.id),
      { active } = z.object({ active: z.boolean() }).parse(req.body);
    await transaction(async (tx) => {
      const u = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { roles: { include: { role: true } } },
      });
      assert(
        !u.roles.some((r) => r.role.protected),
        "OWNER_PROTECTED",
        "Owner accounts cannot be disabled through this endpoint",
        403,
      );
      assert(
        userId !== actor(req).id,
        "SELF_DISABLE",
        "Cannot disable your current account",
      );
      await tx.user.update({ where: { id: userId }, data: { active } });
      await tx.session.deleteMany({ where: { userId } });
      await audit(tx, actor(req).id, "USER_STATUS", userId, { active });
    });
    res.json({ data: { ok: true } });
  }),
);
app.post(
  "/api/users/:id/reset-password",
  can("users.manage"),
  route(async (req, res) => {
    const userId = uuid(req.params.id),
      { password } = z
        .object({ password: z.string().min(8).max(256) })
        .parse(req.body);
    const passwordHash = await hash(password, { type: argon2id });
    await transaction(async (tx) => {
      const u = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { roles: { include: { role: true } } },
      });
      assert(
        actor(req).roles.includes("OWNER") ||
          !u.roles.some((r) => r.role.protected),
        "OWNER_PROTECTED",
        "Protected user",
        403,
      );
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, failedAttempts: 0, lockedUntil: null },
      });
      await tx.session.deleteMany({ where: { userId } });
      await audit(tx, actor(req).id, "CREDENTIAL_RESET", userId);
    });
    res.json({ data: { ok: true } });
  }),
);
app.get(
  "/api/roles",
  can("users.manage", "roles.manage"),
  route(async (_req, res) =>
    res.json({
      data: await db.role.findMany({ include: { permissions: true } }),
    }),
  ),
);
app.get("/api/permissions", can("roles.manage"), (_req, res) =>
  res.json({ data: permissions }),
);
app.post(
  "/api/roles",
  can("roles.manage"),
  route(async (req, res) => {
    assert(
      actor(req).roles.includes("OWNER"),
      "OWNER_REQUIRED",
      "Only owner can manage roles",
      403,
    );
    const input = z
      .object({ name: text, permissions: z.array(z.enum(permissions)) })
      .parse(req.body);
    const role = await transaction(async (tx) => {
      const r = await tx.role.create({
        data: {
          name: input.name,
          permissions: {
            create: input.permissions.map((permissionKey) => ({
              permissionKey,
            })),
          },
        },
      });
      await audit(tx, actor(req).id, "ROLE_CREATE", r.id);
      return r;
    });
    res.status(201).json({ data: role });
  }),
);
app.patch(
  "/api/roles/:id",
  can("roles.manage"),
  route(async (req, res) => {
    assert(
      actor(req).roles.includes("OWNER"),
      "OWNER_REQUIRED",
      "Only owner can manage roles",
      403,
    );
    const roleId = uuid(req.params.id),
      input = z
        .object({ permissions: z.array(z.enum(permissions)) })
        .parse(req.body);
    await transaction(async (tx) => {
      const r = await tx.role.findUniqueOrThrow({ where: { id: roleId } });
      assert(
        !r.protected,
        "OWNER_PROTECTED",
        "Owner role cannot be modified",
        403,
      );
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({
        data: input.permissions.map((permissionKey) => ({
          roleId,
          permissionKey,
        })),
      });
      await audit(tx, actor(req).id, "ROLE_UPDATE", roleId);
    });
    res.json({ data: { ok: true } });
  }),
);

app.get(
  "/api/categories",
  can("products.view"),
  route(async (_req, res) =>
    res.json({
      data: await db.category.findMany({ orderBy: { name: "asc" } }),
    }),
  ),
);
app.post(
  "/api/categories",
  can("products.create"),
  route(async (req, res) => {
    const input = z
      .object({ name: text, parentId: id.optional() })
      .parse(req.body);
    res.status(201).json({ data: await db.category.create({ data: input }) });
  }),
);
app.get(
  "/api/brands",
  can("products.view"),
  route(async (_req, res) => res.json({ data: await db.brand.findMany() })),
);
app.post(
  "/api/brands",
  can("products.create"),
  route(async (req, res) =>
    res.status(201).json({
      data: await db.brand.create({
        data: z.object({ name: text }).parse(req.body),
      }),
    }),
  ),
);
app.get(
  "/api/products",
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
        include: { category: true, variants: { include: { balances: true } } },
        orderBy: { createdAt: "desc" },
        ...page(req.query),
      }),
      db.product.count({ where }),
    ]);
    res.json({ data: data.map((p) => safeProduct(p, hasCosts(req))), total });
  }),
);
app.post(
  "/api/products",
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
app.get(
  "/api/products/:id",
  can("products.view"),
  route(async (req, res) => {
    const p = await db.product.findUnique({
      where: { id: uuid(req.params.id) },
      include: { category: true, variants: { include: { balances: true } } },
    });
    assert(p, "NOT_FOUND", "Product not found", 404);
    res.json({ data: safeProduct(p, hasCosts(req)) });
  }),
);
app.patch(
  "/api/products/:id",
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
app.post(
  "/api/products/:id/archive",
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
app.post(
  "/api/products/:id/variants",
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
app.patch(
  "/api/variants/:id",
  can("products.change_price"),
  route(async (req, res) => {
    const input = variantSchema
        .partial()
        .extend({ active: z.boolean().optional() })
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
app.get(
  "/api/barcodes/:code/lookup",
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
app.post("/api/barcodes/generate", can("products.create"), (_req, res) =>
  res.json({ data: { barcode: barcode() } }),
);

app.get(
  "/api/locations",
  can("inventory.view"),
  route(async (_req, res) =>
    res.json({
      data: await db.stockLocation.findMany({
        include: { branch: { select: { name: true } } },
      }),
    }),
  ),
);
app.get(
  "/api/registers",
  can("cash.open_shift"),
  route(async (_req, res) =>
    res.json({
      data: await db.register.findMany({
        where: { active: true, branch: { active: true } },
      }),
    }),
  ),
);
app.get(
  "/api/inventory",
  can("inventory.view"),
  route(async (req, res) => {
    const data = await db.stockBalance.findMany({
      include: {
        variant: { include: { product: { select: { nameAr: true } } } },
        location: true,
      },
      orderBy: { variantId: "asc" },
      ...page(req.query),
    });
    res.json({
      data: data.map((b) => {
        const out = json(b);
        if (!hasCosts(req)) {
          delete out.averageCost;
          delete out.variant.cost;
        }
        return out;
      }),
    });
  }),
);
app.get(
  "/api/inventory/movements",
  can("inventory.view"),
  route(async (req, res) => {
    const data = await db.stockMovement.findMany({
      include: {
        variant: {
          select: {
            barcode: true,
            sku: true,
            product: { select: { nameAr: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      ...page(req.query),
    });
    res.json({
      data: data.map((m) => {
        const out = json(m);
        if (!hasCosts(req)) delete out.unitCost;
        return out;
      }),
    });
  }),
);
app.post(
  "/api/inventory/adjustments",
  can("inventory.adjust"),
  route(async (req, res) => {
    const input = z
      .object({
        variantId: id,
        locationId: id,
        quantity: z
          .number()
          .int()
          .min(-100000)
          .max(100000)
          .refine((v) => v !== 0),
        reason: z.string().min(3).max(1000),
        cost: money.optional(),
      })
      .parse(req.body);
    res.json({
      data: await once(
        actor(req),
        req.get("Idempotency-Key"),
        "adjust",
        input,
        async (tx) => {
          const document = await postStockDocument(tx, actor(req), {
            type: "ADJUSTMENT",
            sourceId: input.locationId,
            reason: input.reason,
            items: [
              {
                variantId: input.variantId,
                quantity: input.quantity,
                ...(input.cost ? { cost: input.cost } : {}),
              },
            ],
          });
          return { reference: document.id };
        },
      ),
    });
  }),
);
app.get(
  "/api/inventory/stock-counts",
  can("inventory.count"),
  route(async (req, res) =>
    res.json({
      data: await db.stockCount.findMany({
        include: { items: true },
        orderBy: { cutoff: "desc" },
        ...page(req.query),
      }),
    }),
  ),
);
app.post(
  "/api/inventory/stock-counts",
  can("inventory.count"),
  route(async (req, res) => {
    const { locationId, mode } = z
      .object({
        locationId: id,
        mode: z.enum(["CUTOFF", "CONTINUOUS"]).default("CUTOFF"),
      })
      .parse(req.body);
    res.status(201).json({
      data: await transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "StockLocation" WHERE id=${locationId}::uuid FOR UPDATE`;
        const openCounts = await tx.stockCount.findMany({
          where: { locationId, status: "OPEN" },
          select: { mode: true },
        });
        assert(
          !openCounts.some((c) => c.mode === "CONTINUOUS") &&
            (mode !== "CONTINUOUS" || openCounts.length === 0),
          "COUNT_OPEN",
          "أغلق جلسات الجرد المفتوحة في المخزن قبل الجرد المستمر",
        );
        const balances = await tx.stockBalance.findMany({
          where: { locationId },
        });
        const count = await tx.stockCount.create({
          data: {
            locationId,
            mode,
            createdBy: actor(req).id,
            items: {
              create: balances.map((b) => ({
                variantId: b.variantId,
                expected: b.quantity,
              })),
            },
          },
        });
        await audit(tx, actor(req).id, "COUNT_OPEN", count.id);
        return count;
      }),
    });
  }),
);
app.patch(
  "/api/inventory/stock-counts/:id",
  can("inventory.count"),
  route(async (req, res) => {
    const countId = uuid(req.params.id),
      input = z
        .object({
          items: z.array(
            z.object({ variantId: id, actual: z.number().int().nonnegative() }),
          ),
        })
        .parse(req.body);
    await transaction(async (tx) => {
      const count = await tx.stockCount.findUniqueOrThrow({
        where: { id: countId },
      });
      assert(count.status === "OPEN", "COUNT_CLOSED", "Count already approved");
      for (const item of [...input.items].sort((a, b) =>
        a.variantId.localeCompare(b.variantId),
      )) {
        let expected: number | undefined;
        if (count.mode === "CONTINUOUS") {
          await tx.$queryRaw`SELECT quantity FROM "StockBalance" WHERE "variantId"=${item.variantId}::uuid AND "locationId"=${count.locationId}::uuid FOR UPDATE`;
          expected = (
            await tx.stockBalance.findUniqueOrThrow({
              where: {
                variantId_locationId: {
                  variantId: item.variantId,
                  locationId: count.locationId,
                },
              },
            })
          ).quantity;
        }
        await tx.stockCountItem.update({
          where: { countId_variantId: { countId, variantId: item.variantId } },
          data: {
            actual: item.actual,
            countedAt: new Date(),
            ...(expected !== undefined ? { expected } : {}),
          },
        });
      }
    });
    res.json({ data: { ok: true } });
  }),
);
app.post(
  "/api/inventory/stock-counts/:id/approve",
  can("inventory.adjust"),
  route(async (req, res) => {
    const countId = uuid(req.params.id);
    await transaction(async (tx) => {
      const count = await tx.stockCount.findUniqueOrThrow({
        where: { id: countId },
        include: { items: true },
      });
      assert(
        count.status === "OPEN" && count.items.every((i) => i.actual !== null),
        "COUNT_INVALID",
        "Count closed or incomplete",
      );
      const movements = await tx.stockMovement.count({
        where: {
          locationId: count.locationId,
          createdAt: { gte: count.cutoff },
        },
      });
      assert(
        movements === 0 || count.mode === "CONTINUOUS",
        "COUNT_MOVED",
        "Stock moved after cutoff; recount using a new session",
      );
      for (const item of count.items.sort((a, b) =>
        a.variantId.localeCompare(b.variantId),
      )) {
        const diff = item.actual! - item.expected;
        if (count.mode === "CONTINUOUS")
          assert(item.countedAt, "COUNT_INVALID", "أدخل كمية حديثة لكل صنف");
        if (diff)
          await stock(tx, actor(req), {
            variantId: item.variantId,
            locationId: count.locationId,
            quantity: diff,
            type: "COUNT",
            reference: countId,
            reason: "Approved physical count",
          });
      }
      await tx.stockCount.update({
        where: { id: countId },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedBy: actor(req).id,
        },
      });
      await audit(tx, actor(req).id, "COUNT_APPROVE", countId);
    });
    res.json({ data: { ok: true } });
  }),
);
app.get(
  "/api/purchases",
  can("purchases.view"),
  route(async (req, res) =>
    res.json({
      data: await db.purchaseOrder.findMany({
        include: { supplier: true, items: true, receipts: true },
        orderBy: { createdAt: "desc" },
        ...page(req.query),
      }),
    }),
  ),
);
app.post(
  "/api/purchases",
  can("purchases.create"),
  route(async (req, res) => {
    const input = z
      .object({
        supplierId: id,
        locationId: id,
        items: z
          .array(
            z.object({
              variantId: id,
              quantity: z.number().int().positive(),
              unitCost: money,
            }),
          )
          .min(1)
          .max(200),
      })
      .parse(req.body);
    const p = await transaction(async (tx) => {
      const p = await tx.purchaseOrder.create({
        data: {
          ...input,
          createdBy: actor(req).id,
          items: { create: input.items },
        },
        include: { items: true },
      });
      await audit(tx, actor(req).id, "PURCHASE_CREATE", p.id);
      return p;
    });
    res.status(201).json({ data: p });
  }),
);
app.post(
  "/api/purchases/:id/approve",
  can("purchases.receive"),
  route(async (req, res) => {
    const purchaseId = uuid(req.params.id);
    await transaction(async (tx) => {
      const p = await tx.purchaseOrder.updateMany({
        where: { id: purchaseId, status: "DRAFT" },
        data: { status: "APPROVED" },
      });
      assert(p.count === 1, "PURCHASE_STATUS", "Purchase is not draft");
      await audit(tx, actor(req).id, "PURCHASE_APPROVE", purchaseId);
    });
    res.json({ data: { ok: true } });
  }),
);
app.post(
  "/api/purchases/:id/receive",
  can("purchases.receive"),
  route(async (req, res) => {
    const purchaseId = uuid(req.params.id),
      input = receiveSchema.parse(req.body);
    res.json({
      data: await once(
        actor(req),
        req.get("Idempotency-Key"),
        `receive:${purchaseId}`,
        input,
        (tx) => receive(tx, actor(req), purchaseId, input),
      ),
    });
  }),
);

app.post(
  "/api/shifts/open",
  can("cash.open_shift"),
  route(async (req, res) => {
    const input = z
      .object({ registerId: id, openingCash: money })
      .parse(req.body);
    res.status(201).json({
      data: await once(
        actor(req),
        req.get("Idempotency-Key"),
        "open-shift",
        input,
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Register" WHERE id=${input.registerId}::uuid FOR UPDATE`;
          const register = await tx.register.findUnique({
            where: { id: input.registerId },
            include: { branch: true },
          });
          assert(
            register?.active && register.branch.active,
            "REGISTER_INACTIVE",
            "الجهاز أو الفرع غير نشط",
            400,
          );
          const existing = await tx.cashShift.count({
            where: {
              closedAt: null,
              OR: [{ registerId: input.registerId }, { userId: actor(req).id }],
            },
          });
          assert(
            !existing,
            "SHIFT_EXISTS",
            "Register or cashier already has an open shift",
          );
          const s = await tx.cashShift.create({
            data: { ...input, userId: actor(req).id },
          });
          await audit(tx, actor(req).id, "SHIFT_OPEN", s.id);
          return s;
        },
      ),
    });
  }),
);
app.get(
  "/api/shifts/current",
  can("cash.open_shift"),
  route(async (req, res) =>
    res.json({
      data: await db.cashShift.findFirst({
        where: { userId: actor(req).id, closedAt: null },
        include: { register: true },
      }),
    }),
  ),
);
app.get(
  "/api/shifts",
  can("cash.close_shift"),
  route(async (req, res) =>
    res.json({
      data: await db.cashShift.findMany({
        where: actor(req).permissions.includes("cash.view_all")
          ? {}
          : { userId: actor(req).id },
        include: { register: true },
        orderBy: { openedAt: "desc" },
        ...page(req.query),
      }),
    }),
  ),
);
app.post(
  "/api/shifts/:id/cash-movements",
  can("cash.view_all"),
  route(async (req, res) => {
    const shiftId = uuid(req.params.id),
      input = z
        .object({
          type: z.enum(["IN", "OUT"]),
          amount: money.refine((v) => D(v).gt(0)),
          reason: z.string().min(3).max(1000),
        })
        .parse(req.body);
    res.json({
      data: await once(
        actor(req),
        req.get("Idempotency-Key"),
        `cash:${shiftId}`,
        input,
        async (tx) => {
          await activeShift(tx, shiftId, actor(req), false);
          const m = await tx.cashMovement.create({
            data: {
              shiftId,
              userId: actor(req).id,
              type: input.type,
              amount:
                input.type === "IN"
                  ? D(input.amount)
                  : D(input.amount).negated(),
              reason: input.reason,
              reference: crypto.randomUUID(),
            },
          });
          await audit(tx, actor(req).id, "CASH_MOVEMENT", m.id);
          return m;
        },
      ),
    });
  }),
);
app.post(
  "/api/shifts/:id/close",
  can("cash.close_shift"),
  route(async (req, res) => {
    const shiftId = uuid(req.params.id),
      input = z
        .object({ countedCash: money, notes: z.string().max(2000).default("") })
        .parse(req.body);
    res.json({
      data: await once(
        actor(req),
        req.get("Idempotency-Key"),
        `close:${shiftId}`,
        input,
        async (tx) => {
          const s = await activeShift(
            tx,
            shiftId,
            actor(req),
            !actor(req).permissions.includes("cash.view_all"),
          );
          const movements = await tx.cashMovement.aggregate({
              where: { shiftId },
              _sum: { amount: true },
            }),
            expected = s.openingCash.plus(movements._sum.amount ?? 0);
          const closed = await tx.cashShift.update({
            where: { id: shiftId },
            data: {
              countedCash: input.countedCash,
              expectedCash: expected,
              difference: D(input.countedCash).minus(expected),
              notes: input.notes,
              closedAt: new Date(),
            },
          });
          await audit(tx, actor(req).id, "SHIFT_CLOSE", shiftId);
          return closed;
        },
      ),
    });
  }),
);

app.post(
  "/api/sales",
  can("sales.create"),
  route(async (req, res) => {
    const input = checkoutSchema.parse(req.body);
    const result = await once(
      actor(req),
      req.get("Idempotency-Key"),
      "checkout",
      input,
      (tx) => checkout(tx, actor(req), input),
    );
    res.status(201).json({ data: safeSale(result, hasCosts(req)) });
  }),
);
function safeSale(s: any, costs: boolean) {
  const out = json(s);
  function scrub(v: any) {
    if (!v || typeof v !== "object") return;
    for (const key of Object.keys(v)) {
      if (
        key === "passwordHash" ||
        (!costs && ["unitCost", "cost", "inventoryCost"].includes(key))
      )
        delete v[key];
      else scrub(v[key]);
    }
  }
  scrub(out);
  return out;
}
app.get(
  "/api/sales",
  can("sales.view_own", "sales.view_all"),
  route(async (req, res) => {
    const where: Prisma.SaleWhereInput = actor(req).permissions.includes(
      "sales.view_all",
    )
      ? {}
      : { userId: actor(req).id };
    if (req.query.number) {
      const value = z.string().max(64).parse(req.query.number);
      if (/^\d{1,18}$/.test(value)) where.number = BigInt(value);
      else where.receiptNumber = { equals: value, mode: "insensitive" };
    }
    const [data, total] = await Promise.all([
      db.sale.findMany({
        where,
        include: {
          items: true,
          payments: true,
          user: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        ...page(req.query),
      }),
      db.sale.count({ where }),
    ]);
    res.json({ data: data.map((s) => safeSale(s, hasCosts(req))), total });
  }),
);
app.get(
  "/api/sales/:id",
  can("sales.view_own", "sales.view_all"),
  route(async (req, res) => {
    const s = await db.sale.findUnique({
      where: { id: uuid(req.params.id) },
      include: {
        items: true,
        payments: true,
        user: { select: { name: true } },
        customer: { select: { name: true, phone: true, address: true } },
        returns: { include: { items: true } },
      },
    });
    assert(s, "NOT_FOUND", "Sale not found", 404);
    assert(
      s.userId === actor(req).id ||
        actor(req).permissions.includes("sales.view_all"),
      "FORBIDDEN",
      "Access denied",
      403,
    );
    const out = safeSale(s, hasCosts(req));
    if (!hasCosts(req))
      for (const r of out.returns) for (const i of r.items) delete i.cost;
    res.json({ data: out });
  }),
);
app.post(
  "/api/sales/:id/returns",
  can("sales.refund"),
  route(async (req, res) => {
    const saleId = uuid(req.params.id),
      input = returnSchema.parse(req.body);
    res.json({
      data: safeSale(
        await once(
          actor(req),
          req.get("Idempotency-Key"),
          `refund:${saleId}`,
          input,
          (tx) => refund(tx, actor(req), saleId, input),
        ),
        hasCosts(req),
      ),
    });
  }),
);
app.post(
  "/api/sales/:id/exchanges",
  can("sales.refund"),
  can("sales.create"),
  route(async (req, res) => {
    const saleId = uuid(req.params.id),
      input = z
        .object({ returned: returnSchema, replacement: checkoutSchema })
        .parse(req.body);
    const result = (await once(
      actor(req),
      req.get("Idempotency-Key"),
      `exchange:${saleId}`,
      input,
      async (tx) => {
        const returned = await refund(tx, actor(req), saleId, input.returned);
        const replacement = await checkout(tx, actor(req), input.replacement);
        await audit(tx, actor(req).id, "EXCHANGE", replacement.id, {
          returnId: returned.id,
        });
        return { returned, replacement };
      },
    )) as any;
    res.json({
      data: {
        returned: safeSale(result.returned, hasCosts(req)),
        replacement: safeSale(result.replacement, hasCosts(req)),
      },
    });
  }),
);

app.get(
  "/api/customers",
  can("customers.manage", "pos.access"),
  route(async (req, res) => {
    const q = z.string().max(100).default("").parse(req.query.q);
    const { skip, take } = page(req.query);
    res.json(
      await searchCustomers(
        q,
        skip,
        take,
        actor(req).permissions.includes("customers.manage"),
      ),
    );
  }),
);
app.post(
  "/api/customers",
  can("customers.manage"),
  route(async (req, res) => {
    const input = customerSchema.parse(req.body);
    const result = await transaction((tx) =>
      createCustomer(tx, actor(req), input),
    );
    res.status(201).json({ data: result.customer });
  }),
);
app.patch(
  "/api/customers/:id",
  can("customers.manage"),
  route(async (req, res) => {
    const customerId = id.parse(req.params.id);
    const input = z
      .object({
        name: z.string().trim().max(200).default(""),
        phone: customerPhoneSchema,
        email: z.string().email().nullable(),
        address: z.string().max(1000),
        notes: z.string().max(2000),
      })
      .strict()
      .parse(req.body);
    const customer = await transaction(async (tx) => {
      await lockCustomerPhone(tx, input.phone);
      assert(
        !(await matchingPhone(tx, input.phone, customerId)),
        "CUSTOMER_PHONE_EXISTS",
        "رقم التليفون مسجل بالفعل لعميل آخر",
        409,
      );
      assert(
        await tx.customer.findUnique({ where: { id: customerId } }),
        "NOT_FOUND",
        "Customer not found",
        404,
      );
      const updated = await tx.customer.update({
        where: { id: customerId },
        data: input,
      });
      await audit(tx, actor(req).id, "CUSTOMER_UPDATE", customerId, {});
      return updated;
    });
    res.json({ data: customer });
  }),
);
app.get(
  "/api/customers/:id/history",
  can("customers.manage"),
  can("sales.view_own", "sales.view_all"),
  route(async (req, res) => {
    const customerId = id.parse(req.params.id);
    const { skip, take } = page(req.query);
    const all = actor(req).permissions.includes("sales.view_all");
    const where = { customerId, ...(all ? {} : { userId: actor(req).id }) };
    const data = await db.$transaction(
      async (tx) => {
        const customer = await tx.customer.findUnique({
          where: { id: customerId },
        });
        assert(customer, "NOT_FOUND", "Customer not found", 404);
        const [purchases, returned, sales, total, returns, returnCount] =
          await Promise.all([
            tx.sale.aggregate({ where, _sum: { total: true }, _count: true }),
            tx.saleReturn.aggregate({
              where: { sale: where },
              _sum: { total: true },
            }),
            tx.sale.findMany({
              where,
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              skip,
              take,
              select: {
                id: true,
                number: true,
                receiptNumber: true,
                createdAt: true,
                total: true,
                status: true,
                items: {
                  select: {
                    id: true,
                    name: true,
                    sku: true,
                    options: true,
                    quantity: true,
                    returned: true,
                    total: true,
                  },
                },
              },
            }),
            tx.sale.count({ where }),
            tx.saleReturn.findMany({
              where: { sale: where },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              skip,
              take,
              select: {
                id: true,
                createdAt: true,
                total: true,
                refundAmount: true,
                creditAmount: true,
                reason: true,
                sale: { select: { receiptNumber: true, number: true } },
                items: {
                  select: {
                    quantity: true,
                    amount: true,
                    saleItem: { select: { name: true, sku: true } },
                  },
                },
              },
            }),
            tx.saleReturn.count({ where: { sale: where } }),
          ]);
        return {
          customer,
          scope: all ? "ALL" : "OWN",
          summary: {
            purchaseCount: purchases._count,
            purchases: D(purchases._sum.total ?? 0).toFixed(2),
            returns: D(returned._sum.total ?? 0).toFixed(2),
            netSpending: D(purchases._sum.total ?? 0)
              .minus(returned._sum.total ?? 0)
              .toFixed(2),
          },
          sales,
          total,
          returns,
          returnCount,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    res.json({ data });
  }),
);
app.get(
  "/api/expenses",
  can("expenses.view"),
  route(async (req, res) =>
    res.json({
      data: await db.expense.findMany({
        where: req.query.status
          ? {
              status: z
                .enum(["PENDING", "APPROVED", "REJECTED"])
                .parse(req.query.status),
            }
          : {},
        orderBy: { date: "desc" },
        ...page(req.query),
      }),
    }),
  ),
);
app.post(
  "/api/expenses",
  can("expenses.create"),
  route(async (req, res) => {
    const input = expenseInput.parse(req.body);
    res.status(201).json({
      data: await once(
        actor(req),
        req.get("Idempotency-Key"),
        "expense",
        input,
        (tx) => createExpense(tx, actor(req), input),
      ),
    });
  }),
);

app.get("/api/store", (_req, res) => {
  db.systemSetting
    .findUnique({ where: { key: "store" } })
    .then((s) => res.json({ data: s?.value ?? {} }))
    .catch((e) =>
      res.status(500).json({
        error: {
          code: "SETTINGS_UNAVAILABLE",
          message: String(e.code ?? "Unavailable"),
        },
      }),
    );
});
app.patch(
  "/api/settings/store",
  can("settings.manage"),
  route(async (req, res) => {
    const input = z
      .object({
        name: text,
        currency: z.literal("EGP"),
        timezone: z.literal("Africa/Cairo"),
        address: z.string().max(1000),
        phone: z.string().max(40),
        taxRate: money.refine((v) => D(v).lte(100)),
        returnDays: z.number().int().min(0).max(365),
        receiptFooter: z.string().max(1000),
        receiptWidth: z.union([z.literal(58), z.literal(80)]),
        taxMode: z.enum(["INCLUSIVE", "EXCLUSIVE"]).optional(),
        branchName: z.string().max(200).optional(),
        taxNumber: z.string().max(80).optional(),
        commercialRegister: z.string().max(80).optional(),
        invoicePrefix: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,12}$/)
          .optional(),
        returnPolicy: z.string().min(3).max(5000).optional(),
      })
      .parse(req.body);
    await transaction(async (tx) => {
      const previous = await tx.systemSetting.findUnique({
        where: { key: "store" },
      });
      const value = {
        taxMode: "EXCLUSIVE",
        invoicePrefix: "INV",
        returnPolicy: defaultReturnPolicy,
        ...((previous?.value as Record<string, any>) ?? {}),
        ...input,
      };
      await tx.systemSetting.upsert({
        where: { key: "store" },
        create: { key: "store", value },
        update: { value },
      });
      await audit(tx, actor(req).id, "STORE_SETTINGS", "store", input);
    });
    res.json({ data: input });
  }),
);
app.get(
  "/api/audit-logs",
  can("audit.view"),
  route(async (req, res) =>
    res.json({
      data: await db.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        ...page(req.query),
      }),
    }),
  ),
);
app.use("/api/reports", reports);
app.use("/api/barcodes", barcodes);
app.use("/api", supplierRoutes);
app.use("/api", exchanges);
app.use("/api", checkoutRecovery);
app.use("/api", discountApprovals);
app.use("/api", promotions);
app.use("/api", branding);
app.use("/api", productImages);
app.use("/api", expenseWorkflow);
app.use("/api", administration);
app.use("/api", sharedCarts);
app.use("/api", customerDiscounts);
app.use("/api", advancedStock);
app.use("/api", detailedReports);
app.use("/api", loyaltyRoutes);
app.use("/api", stockDocuments);
app.use("/api", customers);
app.post(
  "/api/sales/quote",
  can("sales.create"),
  route(async (req, res) => {
    const input = checkoutSchema.parse(req.body),
      priced = await db.$transaction((tx) => quoteSale(tx, actor(req), input), {
        isolationLevel: "RepeatableRead",
      });
    res.json({
      data: {
        ...priced.sum,
        taxMode: priced.taxMode,
        taxRate: priced.taxRate,
        promotion: priced.promotion,
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
  }),
);
app.use("/api", (_req, _res, next) =>
  next(new AppError(404, "NOT_FOUND", "Endpoint not found")),
);
app.use(
  (
    err: any,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (
      err?.type === "entity.parse.failed" ||
      err?.type === "entity.too.large"
    ) {
      res.status(err.type === "entity.too.large" ? 413 : 400).json({
        error: {
          code: "INVALID_BODY",
          message: "Invalid JSON or request body too large",
        },
      });
      return;
    }
    if (err instanceof z.ZodError) {
      res.status(400).json({
        error: {
          code: "VALIDATION",
          message: "Invalid request",
          fields: err.flatten(),
        },
      });
      return;
    }
    if (err instanceof AppError) {
      res
        .status(err.status)
        .json({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      const code = err.code;
      res.status(code === "P2025" ? 404 : 409).json({
        error: {
          code,
          message:
            code === "P2002"
              ? "Unique value already exists"
              : code === "P2025"
                ? "Record not found"
                : "Operation conflicted; refresh and retry",
        },
      });
      return;
    }
    req.log?.error({ err }, "Request failed");
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    });
  },
);
export default app;
