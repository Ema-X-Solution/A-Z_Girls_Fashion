import type { RequestHandler } from "express";
import { z } from "zod";
import { db } from "../lib/db.js";
import { actor } from "../middleware/auth.js";
import { route } from "../utils/http.js";
import { AppError } from "../lib/db.js";

// Explicit model/permission map, never accept a model name as a database key.
export const handleEntityOptions: RequestHandler = route(async (req, res) => {
  const kind = z
    .enum([
      "suppliers",
      "locations",
      "registers",
      "categories",
      "brands",
      "roles",
      "users",
      "branches",
      "expense-categories",
    ])
    .parse(req.params.kind);
  const grants: Record<typeof kind, string[]> = {
    "expense-categories": ["expenses.create", "expenses.view"],
    suppliers: ["suppliers.view", "purchases.create", "suppliers.manage", "products.view", "products.create", "products.update"],
    locations: [
      "inventory.view",
      "inventory.count",
      "inventory.adjust",
      "inventory.transfer",
      "purchases.create",
      "settings.manage",
      "products.view",
    ],
    registers: ["cash.open_shift", "settings.manage"],
    categories: ["products.view", "products.create"],
    brands: ["products.view", "products.create"],
    roles: ["roles.manage", "users.manage"],
    users: ["users.manage"],
    branches: ["settings.manage", "inventory.transfer", "inventory.adjust"],
  };
  if (!grants[kind].some((p) => actor(req).permissions.includes(p)))
    throw new AppError(403, "FORBIDDEN", "Permission denied");
  const q = z.string().max(200).default("").parse(req.query.q),
    skip = z.coerce.number().int().min(0).default(0).parse(req.query.offset),
    selected = z.string().uuid().optional().parse(req.query.selected);
  const branchId = z.string().uuid().optional().parse(req.query.branchId);
  const exclude = z.string().uuid().optional().parse(req.query.exclude);
  const where = {
    ...(exclude ? { id: { not: exclude } } : {}),
    ...(kind === "categories" ? { archivedAt: null } : {}),
    ...(["suppliers", "users", "branches", "expense-categories"].includes(kind)
      ? { active: true }
      : {}),
    ...(kind === "registers" ? { active: true, branch: { active: true } } : {}),
    ...(kind === "locations" && branchId ? { branchId } : {}),
    ...(kind === "roles" && req.query.assignable === "1"
      ? { protected: false }
      : {}),
    ...(q ? (kind === "suppliers" ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { code: { contains: q, mode: "insensitive" as const } }] } : { name: { contains: q, mode: "insensitive" as const } }) : {}),
  };
  const args = {
    where,
    orderBy: [{ name: "asc" as const }, { id: "asc" as const }],
    skip,
    take: 51,
    select: { id: true, name: true, ...(kind === "suppliers" ? { code: true } : {}) },
  };
  const model = {
    "expense-categories": db.expenseCategory,
    suppliers: db.supplier,
    locations: db.stockLocation,
    registers: db.register,
    categories: db.category,
    brands: db.brand,
    roles: db.role,
    users: db.user,
    branches: db.branch,
  }[kind];
  // All mapped models share this minimal id/name projection; sensitive fields never leave the DB.
  const read = model as unknown as {
    findMany: (args: unknown) => Promise<{ id: string; name: string }[]>;
    findUnique: (args: unknown) => Promise<{ id: string; name: string } | null>;
  };
  const rows = await read.findMany(args),
    chosen = selected
      ? await read.findUnique({
          where: { id: selected },
          select: { id: true, name: true, ...(kind === "suppliers" ? { code: true } : {}) },
        })
      : null;
  res.json({
    data: rows.slice(0, 50),
    hasMore: rows.length > 50,
    selected: chosen,
  });
});
