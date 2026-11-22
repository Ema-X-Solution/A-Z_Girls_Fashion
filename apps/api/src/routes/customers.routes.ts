import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/customers.controller.js";

export const customersRouter = Router();

customersRouter.get(
  "/customers",
  can("customers.manage", "pos.access"),
  controllers.handleGetCustomers,
);

customersRouter.post(
  "/customers",
  can("customers.manage"),
  controllers.handlePostCustomers,
);

customersRouter.patch(
  "/customers/:id",
  can("customers.manage"),
  controllers.handlePatchCustomersById,
);

customersRouter.get(
  "/customers/:id/history",
  can("customers.manage"),
  can("sales.view_own", "sales.view_all"),
  controllers.handleGetCustomersByIdHistory,
);
