import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/detailed-reports.controller.js";
export { reportTitles } from "../controllers/detailed-reports.controller.js";

export const detailedReports = Router();

detailedReports.get(
  "/reports/cashiers",
  can("reports.sales"),
  controllers.handleGetReportsCashiers,
);

detailedReports.get(
  "/reports/detail/:kind",
  can("reports.sales", "reports.inventory"),
  controllers.handleGetReportsDetailByKind,
);
