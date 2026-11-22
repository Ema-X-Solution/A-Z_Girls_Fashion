import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/stock-documents.controller.js";
export { stockDocumentSchema, postStockDocument } from "../controllers/stock-documents.controller.js";

export const stockDocuments = Router();

stockDocuments.get(
  "/inventory/documents",
  can("inventory.view"),
  controllers.handleGetInventoryDocuments,
);

stockDocuments.post(
  "/inventory/documents",
  can("inventory.adjust"),
  controllers.handlePostInventoryDocuments,
);

stockDocuments.post(
  "/inventory/locations",
  can("inventory.adjust"),
  controllers.handlePostInventoryLocations,
);
