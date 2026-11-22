import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/checkout-recovery.controller.js";

export const checkoutRecovery = Router();

checkoutRecovery.get(
  "/checkout-attempts/:key",
  can("sales.create"),
  controllers.handleGetCheckoutAttemptsByKey,
);

checkoutRecovery.post(
  "/checkout-attempts/:key/cancel",
  can("sales.create"),
  controllers.handlePostCheckoutAttemptsByKeyCancel,
);
