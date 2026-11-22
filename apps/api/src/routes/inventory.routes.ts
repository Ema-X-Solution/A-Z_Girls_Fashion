import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/inventory.controller.js";

export const inventoryRouter = Router();

inventoryRouter.get(
  "/inventory",
  can("inventory.view"),
  controllers.handleGetInventory,
);

inventoryRouter.get(
  "/inventory/movements",
  can("inventory.view"),
  controllers.handleGetInventoryMovements,
);

inventoryRouter.post(
  "/inventory/adjustments",
  can("inventory.adjust"),
  controllers.handlePostInventoryAdjustments,
);

inventoryRouter.get(
  "/inventory/stock-counts",
  can("inventory.count"),
  controllers.handleGetInventoryStockCounts,
);

inventoryRouter.post(
  "/inventory/stock-counts",
  can("inventory.count"),
  controllers.handlePostInventoryStockCounts,
);

inventoryRouter.patch(
  "/inventory/stock-counts/:id",
  can("inventory.count"),
  controllers.handlePatchInventoryStockCountsById,
);

inventoryRouter.post(
  "/inventory/stock-counts/:id/approve",
  can("inventory.adjust"),
  controllers.handlePostInventoryStockCountsByIdApprove,
);
