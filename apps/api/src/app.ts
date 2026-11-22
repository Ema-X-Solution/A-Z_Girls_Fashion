import express from "express";
import { roles } from "./routes/roles.routes.js";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { verify } from "argon2";
import { pinoHttp } from "pino-http";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db, assert, AppError, audit, transaction } from "./lib/db.js";
import { actor, authenticate, cookieName, cookieOptions, digest, token } from "./middleware/auth.js";
import { reports } from "./routes/reports.js";
import { isAllowedOrigin } from "./config/origins.js";
import { barcodes } from "./routes/barcodes.js";
import { supplierRoutes } from "./routes/supplier-routes.js";
import { exchanges } from "./routes/exchanges.js";
import { checkoutRecovery } from "./routes/checkout-recovery.js";
import { discountApprovals } from "./routes/discount-approvals.js";
import { promotions } from "./routes/promotions.js";
import { publicBranding, branding } from "./routes/branding.js";
import { expenseWorkflow } from "./routes/expense-workflow.js";
import { administration } from "./routes/administration.js";
import { sharedCarts } from "./routes/shared-carts.js";
import { customerDiscounts } from "./routes/customer-discounts.js";
import { advancedStock } from "./routes/advanced-stock.js";
import { detailedReports } from "./routes/detailed-reports.js";
import { productImages } from "./routes/product-images.js";
import { loyaltyRoutes } from "./routes/loyalty-routes.js";
import { stockDocuments } from "./routes/stock-documents.js";
import { customers } from "./routes/customers.js";
import { route } from "./utils/http.js";

import { catalogRouter } from "./routes/catalog.routes.js";
import { usersRouter } from "./routes/users.routes.js";
import { resourcesRouter } from "./routes/resources.routes.js";
import { inventoryRouter } from "./routes/inventory.routes.js";
import { purchasesRouter } from "./routes/purchases.routes.js";
import { shiftsRouter } from "./routes/shifts.routes.js";
import { salesRouter } from "./routes/sales.routes.js";
import { customersRouter } from "./routes/customers.routes.js";
import { expensesRouter } from "./routes/expenses.routes.js";
import { settingsRouter } from "./routes/settings.routes.js";
import { auditRouter } from "./routes/audit.routes.js";
import { salesQuoteRouter } from "./routes/sales-quote.routes.js";

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

app.use("/api", usersRouter);

app.use("/api", roles);

app.use("/api", catalogRouter);

app.use("/api", resourcesRouter);

app.use("/api", inventoryRouter);

app.use("/api", purchasesRouter);

app.use("/api", shiftsRouter);

app.use("/api", salesRouter);

app.use("/api", customersRouter);

app.use("/api", expensesRouter);

app.use("/api", settingsRouter);

app.use("/api", auditRouter);

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

app.use("/api", salesQuoteRouter);

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
