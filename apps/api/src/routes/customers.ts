import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/customer-resolution.controller.js";
export { customerSchema, matchingPhone, lockCustomerPhone, createCustomer, searchCustomers } from "../controllers/customer-resolution.controller.js";

export const customers = Router();

customers.post(
  "/customers/resolve",
  can("pos.access"),
  can("sales.create"),
  controllers.handlePostCustomersResolve,
);

customers.get(
  "/customers/:id",
  can("customers.manage", "pos.access"),
  controllers.handleGetCustomersById,
);
