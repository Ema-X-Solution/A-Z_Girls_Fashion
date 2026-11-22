import type { RequestHandler } from "express";
import { db } from "../lib/db.js";
import { route, page } from "../utils/http.js";

export const handleGetAuditLogs: RequestHandler = route(async (req, res) =>
    res.json({
      data: await db.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        ...page(req.query),
      }),
    }),
  );
