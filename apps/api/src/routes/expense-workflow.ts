import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/expense-workflow.controller.js";
export { expenseInput, createExpense } from "../controllers/expense-workflow.controller.js";

export const expenseWorkflow = Router();

expenseWorkflow.get(
  "/expense-categories",
  can("expenses.view", "expenses.create"),
  controllers.handleGetExpenseCategories,
);

expenseWorkflow.post(
  "/expense-categories",
  can("expenses.approve"),
  controllers.handlePostExpenseCategories,
);

expenseWorkflow.patch(
  "/expense-categories/:id",
  can("expenses.approve"),
  controllers.handlePatchExpenseCategoriesById,
);

expenseWorkflow.post(
  "/expenses/:id/decision",
  can("expenses.approve"),
  controllers.handlePostExpensesByIdDecision,
);

expenseWorkflow.get(
  "/expenses/:id/attachments",
  can("expenses.view", "expenses.create"),
  controllers.handleGetExpensesByIdAttachments,
);

expenseWorkflow.post(
  "/expenses/:id/attachments",
  can("expenses.create"),
  controllers.handlePostExpensesByIdAttachments,
);

expenseWorkflow.get(
  "/expense-attachments/:id",
  can("expenses.view", "expenses.create"),
  controllers.handleGetExpenseAttachmentsById,
);
