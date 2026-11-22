import { Router } from "express";
import { z } from "zod";
import { db } from "../../db.js";
import { actor, requirePermission as can } from "../../auth.js";
import { once } from "../../operations.js";
import { expenseInput, createExpense } from "../../expense-workflow.js";
import { route, page } from "../http/support.js";

export const expensesRouter = Router();

expensesRouter.get(
  "/expenses",
  can("expenses.view"),
  route(async (req, res) =>
    res.json({
      data: await db.expense.findMany({
        where: req.query.status
          ? {
              status: z
                .enum(["PENDING", "APPROVED", "REJECTED"])
                .parse(req.query.status),
            }
          : {},
        orderBy: { date: "desc" },
        ...page(req.query),
      }),
    }),
  ),
);

expensesRouter.post(
  "/expenses",
  can("expenses.create"),
  route(async (req, res) => {
    const input = expenseInput.parse(req.body);
    res.status(201).json({
      data: await once(
        actor(req),
        req.get("Idempotency-Key"),
        "expense",
        input,
        (tx) => createExpense(tx, actor(req), input),
      ),
    });
  }),
);
