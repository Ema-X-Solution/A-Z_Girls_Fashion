import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/loyalty-routes.controller.js";

export const loyaltyRoutes = Router();

loyaltyRoutes.get(
  "/loyalty/settings",
  can("pos.access", "customers.manage", "settings.manage"),
  controllers.handleGetLoyaltySettings,
);

loyaltyRoutes.patch(
  "/loyalty/settings",
  can("settings.manage"),
  controllers.handlePatchLoyaltySettings,
);

loyaltyRoutes.get(
  "/customers/:id/loyalty",
  can("pos.access", "customers.manage"),
  controllers.handleGetCustomersByIdLoyalty,
);
