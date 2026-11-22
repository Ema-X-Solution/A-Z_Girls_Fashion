import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/reports.controller.js";
export { dashboardData } from "../controllers/reports.controller.js";

export const reports = Router();

reports.get(
  "/dashboard",
  can("dashboard.view", "reports.sales"),
  controllers.handleGetDashboard,
);

reports.get("/sales/export", can("reports.sales"), controllers.handleGetSalesExport);
