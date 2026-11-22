import { Router } from "express";
import { db } from "../lib/db.js";
import { requirePermission as can } from "../middleware/auth.js";
import { route } from "../utils/http.js";

export const resourcesRouter = Router();

resourcesRouter.get(
  "/locations",
  can("inventory.view"),
  route(async (_req, res) =>
    res.json({
      data: await db.stockLocation.findMany({
        include: { branch: { select: { name: true } } },
      }),
    }),
  ),
);

resourcesRouter.get(
  "/registers",
  can("cash.open_shift"),
  route(async (_req, res) =>
    res.json({
      data: await db.register.findMany({
        where: { active: true, branch: { active: true } },
      }),
    }),
  ),
);
