import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/supplier-routes.controller.js";

export const supplierRoutes = Router();

supplierRoutes.get(
  "/suppliers",
  can("suppliers.manage", "purchases.view"),
  controllers.handleGetSuppliers,
);

supplierRoutes.post(
  "/suppliers",
  can("suppliers.manage"),
  controllers.handlePostSuppliers,
);

supplierRoutes.patch(
  "/suppliers/:id",
  can("suppliers.manage"),
  controllers.handlePatchSuppliersById,
);

supplierRoutes.post(
  "/suppliers/:id/payments",
  can("suppliers.manage"),
  controllers.handlePostSuppliersByIdPayments,
);

supplierRoutes.get(
  "/suppliers/:id/statement",
  can("suppliers.manage"),
  controllers.handleGetSuppliersByIdStatement,
);

supplierRoutes.get(
  "/suppliers/:id/invoices",
  can("suppliers.manage"),
  controllers.handleGetSuppliersByIdInvoices,
);

supplierRoutes.get(
  "/supplier-invoices/:id",
  can("suppliers.manage"),
  controllers.handleGetSupplierInvoicesById,
);

supplierRoutes.post(
  "/supplier-invoices/:id/returns",
  can("suppliers.manage"),
  can("purchases.receive"),
  controllers.handlePostSupplierInvoicesByIdReturns,
);

supplierRoutes.get(
  "/suppliers/:id/returns",
  can("suppliers.manage"),
  controllers.handleGetSuppliersByIdReturns,
);
