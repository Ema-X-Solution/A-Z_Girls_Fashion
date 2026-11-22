import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/sales-quote.controller.js";

export const salesQuoteRouter = Router();

salesQuoteRouter.post(
  "/sales/quote",
  can("sales.create"),
  controllers.handlePostSalesQuote,
);
