import { handleEntityOptions } from "../controllers/entity-options.controller.js";
import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/resources.controller.js";

export const resourcesRouter = Router();

resourcesRouter.get("/options/:kind",handleEntityOptions);

resourcesRouter.get(
  "/locations",
  can("inventory.view"),
  controllers.handleGetLocations,
);

resourcesRouter.get(
  "/registers",
  can("cash.open_shift"),
  controllers.handleGetRegisters,
);
