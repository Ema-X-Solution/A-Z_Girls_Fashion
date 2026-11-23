import type { Prisma } from "@prisma/client";
import type { Actor } from "../middleware/auth.js";

export function canSellAsSelf(actor: Actor): boolean {
  return actor.roles.some((role) => role === "OWNER" || role === "MANAGER");
}

// Administrative accounts may attribute a sale to themselves, never to another
// administrator. Everyone can still choose an active, explicitly assigned cashier.
export function selectableCashierScope(actor: Actor): Prisma.UserWhereInput {
  const assignedCashier: Prisma.UserWhereInput = {
    roles: { some: { role: { name: "كاشير" } } },
  };
  return {
    active: true,
    ...(canSellAsSelf(actor)
      ? { OR: [assignedCashier, { id: actor.id }] }
      : assignedCashier),
  };
}
