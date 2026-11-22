import { Router } from "express";

import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/audit.controller.js";

export const auditRouter = Router();

auditRouter.get(
  "/audit-logs",
  can("audit.view"),
  controllers.handleGetAuditLogs,
);
