import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/shifts.controller.js";

export const shiftsRouter = Router();

shiftsRouter.post(
  "/shifts/open",
  can("cash.open_shift"),
  controllers.handlePostShiftsOpen,
);

shiftsRouter.get(
  "/shifts/current",
  can("cash.open_shift"),
  controllers.handleGetShiftsCurrent,
);

shiftsRouter.get(
  "/shifts",
  can("cash.close_shift"),
  controllers.handleGetShifts,
);

shiftsRouter.post(
  "/shifts/:id/cash-movements",
  can("cash.view_all"),
  controllers.handlePostShiftsByIdCashMovements,
);

shiftsRouter.post(
  "/shifts/:id/close",
  can("cash.close_shift"),
  controllers.handlePostShiftsByIdClose,
);
