import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/customer-discounts.controller.js";

export const customerDiscounts = Router();

customerDiscounts.patch(
  "/customers/:id/discount",
  can("settings.manage"),
  controllers.handlePatchCustomersByIdDiscount,
);
