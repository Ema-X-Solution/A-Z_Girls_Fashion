import { listResult, usesPagination } from "../utils/pagination.js";
import type { RequestHandler } from "express";
import { db } from "../lib/db.js";
import { route, page } from "../utils/http.js";

export const handleGetAuditLogs: RequestHandler = route(async (req, res) => {
  const rows = await db.auditLog.findMany({
    orderBy: usesPagination(req.query)?[{ createdAt: "desc" }, {id:"desc"}]:{createdAt:"desc"},
    ...page(req.query),
  });
  const ids = [
    ...new Set(rows.flatMap((row) => (row.userId ? [row.userId] : []))),
  ];
  const users = ids.length
    ? await db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      })
    : [];
  const names = new Map(users.map((user) => [user.id, user.name]));
  const total=usesPagination(req.query)?await db.auditLog.count():0;
  res.json(listResult(req.query,rows.map((row) => ({
      ...row,
      userName: row.userId ? (names.get(row.userId) ?? null) : null,
    })),total));
});
