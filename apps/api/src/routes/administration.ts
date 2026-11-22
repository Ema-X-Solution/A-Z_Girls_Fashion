import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/administration.controller.js";

export const administration = Router();

administration.get(
  "/administration/branches",
  can("settings.manage"),
  controllers.handleGetAdministrationBranches,
);

administration.post(
  "/administration/branches",
  can("settings.manage"),
  controllers.handlePostAdministrationBranches,
);

administration.patch(
  "/administration/branches/:id",
  can("settings.manage"),
  controllers.handlePatchAdministrationBranchesById,
);

administration.post(
  "/administration/registers",
  can("settings.manage"),
  controllers.handlePostAdministrationRegisters,
);

administration.patch(
  "/administration/registers/:id",
  can("settings.manage"),
  controllers.handlePatchAdministrationRegistersById,
);

administration.get(
  "/administration/sessions",
  can("users.manage"),
  controllers.handleGetAdministrationSessions,
);

administration.post(
  "/administration/sessions/:id/revoke",
  can("users.manage"),
  controllers.handlePostAdministrationSessionsByIdRevoke,
);

administration.post(
  "/administration/users/:id/revoke-sessions",
  can("users.manage"),
  controllers.handlePostAdministrationUsersByIdRevokeSessions,
);

administration.patch(
  "/administration/users/:id/role",
  can("roles.manage"),
  can("users.manage"),
  controllers.handlePatchAdministrationUsersByIdRole,
);
