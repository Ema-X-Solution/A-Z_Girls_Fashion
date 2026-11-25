import { handlePurchaseItemOptions } from "../controllers/purchase-item-options.controller.js";
import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/purchases.controller.js";

export const purchasesRouter = Router();

purchasesRouter.get(
  "/purchases/item-options",
  can("purchases.create"),
  handlePurchaseItemOptions,
);

purchasesRouter.get(
  "/purchases",
  can("purchases.view", "purchases.preview"),
  controllers.handleGetPurchases,
);

purchasesRouter.post(
  "/purchases",
  can("purchases.create"),
  controllers.handlePostPurchases,
);

purchasesRouter.patch(
  "/purchases/:id",
  can("purchases.create"),
  controllers.handlePatchPurchasesById,
);

purchasesRouter.post(
  "/purchases/:id/unapprove",
  can("purchases.receive"),
  controllers.handlePostPurchasesByIdUnapprove,
);

purchasesRouter.post(
  "/purchases/:id/approve",
  can("purchases.receive"),
  controllers.handlePostPurchasesByIdApprove,
);

purchasesRouter.post(
  "/purchases/:id/receive",
  can("purchases.receive"),
  controllers.handlePostPurchasesByIdReceive,
);

purchasesRouter.get(
  "/purchases/:id/pdf",
  can("purchases.view", "purchases.preview"),
  controllers.handleGetPurchasePdf,
);
