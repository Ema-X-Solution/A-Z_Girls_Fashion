import type { RequestHandler } from "express";
import { db } from "../lib/db.js";
import { route } from "../utils/http.js";

export const handleGetHealth: RequestHandler = route(async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: "ok" });
  });
