import type { RequestHandler } from "express";
import { db } from "../lib/db.js";
import { route } from "../utils/http.js";

export const handleGetLocations: RequestHandler = route(async (_req, res) =>
    res.json({
      data: await db.stockLocation.findMany({
        include: { branch: { select: { name: true } } },
      }),
    }),
  );

export const handleGetRegisters: RequestHandler = route(async (_req, res) =>
    res.json({
      data: await db.register.findMany({
        where: { active: true, branch: { active: true } },
      }),
    }),
  );
