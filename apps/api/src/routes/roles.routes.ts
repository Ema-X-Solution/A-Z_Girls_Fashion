import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/roles.controller.js";

export const roles = Router();

roles.get("/roles", can("users.manage", "roles.manage"), controllers.handleGetRoles);

roles.get("/permissions", can("roles.manage"), controllers.handleGetPermissions);

roles.post("/roles", can("roles.manage"), controllers.handlePostRoles);

roles.patch("/roles/:id", can("roles.manage"), controllers.handlePatchRolesById);
