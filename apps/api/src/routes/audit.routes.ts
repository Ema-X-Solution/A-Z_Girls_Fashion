import { Router } from "express";
import { db } from "../lib/db.js";
import { requirePermission as can } from "../middleware/auth.js";
import { route, page } from "../utils/http.js";

export const auditRouter = Router();

auditRouter.get(
  "/audit-logs",
  can("audit.view"),
  route(async (req, res) =>
    res.json({
      data: await db.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        ...page(req.query),
      }),
    }),
  ),
);
