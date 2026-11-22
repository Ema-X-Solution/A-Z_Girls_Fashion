import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/barcodes.controller.js";
export { internalBarcode, labelRequest } from "../controllers/barcodes.controller.js";

export const barcodes = Router();

barcodes.get(
  "/receipts/:id/items",
  can("purchases.view"),
  controllers.handleGetReceiptsByIdItems,
);

barcodes.post("/print-labels", can("products.view"), controllers.handlePostPrintLabels);
