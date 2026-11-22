import { Router } from "express";

import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/branding.controller.js";

export const publicBranding = Router(),
  branding = Router();

publicBranding.get("/branding", controllers.handleGetBranding);

publicBranding.get("/brand-assets/:id", controllers.handleGetBrandAssetsById);

branding.post(
  "/settings/logo",
  can("settings.manage"),
  controllers.handlePostSettingsLogo,
);
