import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/advanced-stock.controller.js";

export const advancedStock = Router();

advancedStock.post(
  "/inventory/stock-counts/:id/cancel",
  can("inventory.count"),
  controllers.handlePostInventoryStockCountsByIdCancel,
);

advancedStock.get(
  "/inventory/shipments",
  can("inventory.view"),
  controllers.handleGetInventoryShipments,
);

advancedStock.post(
  "/inventory/shipments",
  can("inventory.adjust"),
  controllers.handlePostInventoryShipments,
);

advancedStock.post(
  "/inventory/shipments/:id/receive",
  can("purchases.receive", "inventory.adjust"),
  controllers.handlePostInventoryShipmentsByIdReceive,
);

advancedStock.get(
  "/inventory/holds",
  can("inventory.view"),
  controllers.handleGetInventoryHolds,
);

advancedStock.post(
  "/inventory/holds",
  can("inventory.adjust"),
  controllers.handlePostInventoryHolds,
);

advancedStock.post(
  "/inventory/holds/:id/resolve",
  can("inventory.adjust"),
  controllers.handlePostInventoryHoldsByIdResolve,
);
