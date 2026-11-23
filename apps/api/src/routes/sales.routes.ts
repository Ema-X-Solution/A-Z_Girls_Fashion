import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/sales.controller.js";

export const salesRouter = Router();
salesRouter.get(
  "/sales/cashiers",
  can("sales.create"),
  controllers.handleGetSelectableCashiers,
);

salesRouter.post("/sales", can("sales.create"), controllers.handlePostSales);

salesRouter.get(
  "/sales",
  can("sales.view_own", "sales.view_all"),
  controllers.handleGetSales,
);

salesRouter.get(
  "/sales/:id",
  can("sales.view_own", "sales.view_all"),
  controllers.handleGetSalesById,
);

salesRouter.post(
  "/sales/:id/returns",
  can("sales.refund"),
  controllers.handlePostSalesByIdReturns,
);

salesRouter.post(
  "/sales/:id/exchanges",
  can("sales.refund"),
  can("sales.create"),
  controllers.handlePostSalesByIdExchanges,
);
