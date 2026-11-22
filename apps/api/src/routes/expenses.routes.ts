import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/expenses.controller.js";

export const expensesRouter = Router();

expensesRouter.get(
  "/expenses",
  can("expenses.view"),
  controllers.handleGetExpenses,
);

expensesRouter.post(
  "/expenses",
  can("expenses.create"),
  controllers.handlePostExpenses,
);
