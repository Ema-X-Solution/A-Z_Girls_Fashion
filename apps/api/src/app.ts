import { accounting } from "./routes/accounting.js";
import * as authControllers from "./controllers/auth.controller.js";
import * as systemControllers from "./controllers/system.controller.js";
import express from "express";
import { roles } from "./routes/roles.routes.js";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { AppError } from "./lib/db.js";
import { authenticate } from "./middleware/auth.js";
import { reports } from "./routes/reports.js";
import { barcodes } from "./routes/barcodes.js";
import { supplierRoutes } from "./routes/supplier-routes.js";
import { exchanges } from "./routes/exchanges.js";
import { checkoutRecovery } from "./routes/checkout-recovery.js";
import { discountApprovals } from "./routes/discount-approvals.js";
import { promotions } from "./routes/promotions.js";
import { publicBranding, branding } from "./routes/branding.js";
import { expenseWorkflow } from "./routes/expense-workflow.js";
import { administration } from "./routes/administration.js";
import { customerDiscounts } from "./routes/customer-discounts.js";
import { advancedStock } from "./routes/advanced-stock.js";
import { detailedReports } from "./routes/detailed-reports.js";
import { productImages } from "./routes/product-images.js";
import { loyaltyRoutes } from "./routes/loyalty-routes.js";
import { stockDocuments } from "./routes/stock-documents.js";
import { customers } from "./routes/customers.js";

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
  systemControllers.handleGetHealth,
);

app.post(
  "/api/auth/login",
  rateLimit({
    windowMs: 900000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  authControllers.handlePostAuthLogin,
);

app.use("/api", publicBranding);

app.use("/api", authenticate);

app.get("/api/auth/me", authControllers.handleGetAuthMe,
);

app.post(
  "/api/auth/logout",
  authControllers.handlePostAuthLogout,
);

app.post(
  "/api/auth/refresh",
  authControllers.handlePostAuthRefresh,
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
app.use("/api", accounting);

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
    if (String(err?.message).includes("ACCOUNTING_PERIOD_CLOSED")) {
      res.status(409).json({error:{code:"PERIOD_CLOSED",message:"الفترة مقفلة، لا يمكن تعديل بياناتها"}}); return;
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
