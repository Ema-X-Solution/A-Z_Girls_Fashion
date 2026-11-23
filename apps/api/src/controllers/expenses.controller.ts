import { listResult } from "../utils/pagination.js";
import type { RequestHandler } from "express";
import { z } from "zod";
import { db } from "../lib/db.js";
import { actor } from "../middleware/auth.js";
import { once } from "../services/operations.js";
import { expenseInput, createExpense } from "../routes/expense-workflow.js";
import { route, page } from "../utils/http.js";

export const handleGetExpenses: RequestHandler = route(async (req,res)=>{
 const where = req.query.status ? { status:z.enum(["PENDING","APPROVED","REJECTED"]).parse(req.query.status) } : {};
 const [data,total]=await Promise.all([db.expense.findMany({where,orderBy:[{date:"desc"},{id:"desc"}],...page(req.query)}),db.expense.count({where})]);
 res.json(listResult(req.query,data,total));
});

export const handlePostExpenses: RequestHandler = route(async (req, res) => {
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
  });
