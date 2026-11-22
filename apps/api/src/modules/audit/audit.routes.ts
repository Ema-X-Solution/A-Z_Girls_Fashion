import { Router } from "express";
import { db } from "../../db.js";
import { requirePermission as can } from "../../auth.js";
import { route, page } from "../http/support.js";

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
