import { z } from "zod";
import { db } from "../lib/db.js";
import type { Prisma } from "@prisma/client";
export async function userOptions(
  query: Record<string, unknown>,
  scope: Prisma.UserWhereInput,
) {
  const q = z.string().max(200).default("").parse(query.q),
    offset = z.coerce.number().int().min(0).default(0).parse(query.offset),
    selected = z.string().uuid().optional().parse(query.selected);
  const select = { id: true, name: true, employeeCode: true };
  const rows = await db.user.findMany({
    where: {
      AND: [
        scope,
        q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { employeeCode: { contains: q, mode: "insensitive" } },
              ],
            }
          : {},
      ],
    },
    select,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    skip: offset,
    take: 51,
  });
  const chosen = selected
    ? await db.user.findFirst({
        where: { AND: [scope, { id: selected }] },
        select,
      })
    : null;
  const display = (u: (typeof rows)[number]) => ({
    ...u,
    sellerCode: u.employeeCode ?? u.id.slice(0, 8).toUpperCase(),
  });
  return {
    data: rows.slice(0, 50).map(display),
    hasMore: rows.length > 50,
    selected: chosen ? display(chosen) : null,
  };
}
