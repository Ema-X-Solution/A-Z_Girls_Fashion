import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/settings.controller.js";

export const settingsRouter = Router();

settingsRouter.get("/store", controllers.handleGetStore);

settingsRouter.patch(
  "/settings/store",
  can("settings.manage"),
  controllers.handlePatchSettingsStore,
);
