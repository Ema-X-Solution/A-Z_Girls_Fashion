import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/promotions.controller.js";

export const promotions = Router();

promotions.get(
  "/promotions",
  can("promotions.manage"),
  controllers.handleGetPromotions,
);

promotions.post("/promotions", can("promotions.manage"), controllers.handlePostPromotions);

promotions.patch("/promotions/:id", can("promotions.manage"), controllers.handlePatchPromotionsById);
