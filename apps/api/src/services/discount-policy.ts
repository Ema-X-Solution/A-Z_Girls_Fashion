import type { z } from "zod";
import type { checkoutSchema } from "@az/shared";
import { assert, type Tx } from "../lib/db.js";
import { digest, type Actor } from "../middleware/auth.js";
import { D } from "../utils/money.js";
export async function approvalActor(tx: Tx, id: string): Promise<Actor> {
  const user = await tx.user.findUnique({
    where: { id },
    include: {
      roles: { include: { role: { include: { permissions: true } } } },
    },
  });
  assert(
    user?.active,
    "APPROVER_UNAVAILABLE",
    "Approval user is inactive",
    403,
  );
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    discountLimit: user.discountLimit.toString(),
    roles: user.roles.map((r) => r.role.name),
    permissions: user.roles.flatMap((r) =>
      r.role.permissions.map((p) => p.permissionKey),
    ),
  };
}
export function approvalFingerprint(
  actor: Actor,
  input: z.infer<typeof checkoutSchema>,
  pricing: any,
) {
  return digest(
    JSON.stringify({
      requesterId: actor.id,
      shiftId: input.shiftId,
      customerId: input.customerId ?? null,
      loyaltyPoints: input.loyaltyPoints ?? 0,
      notes: input.notes,
      items: pricing.lines.map((l: any) => ({
        id: l.variantId,
        quantity: l.quantity,
        price: l.variant.price.toFixed(2),
        discount: D(l.discount).toFixed(2),
        discountType: l.discountType,
      })),
      discount: D(input.discount).toFixed(2),
      discountType: input.discountType,
      taxRate: D(pricing.taxRate).toFixed(2),
      promotion: pricing.promotion ?? null,
      taxMode: pricing.taxMode,
      subtotal: pricing.sum.subtotal.toFixed(2),
      appliedDiscount: pricing.sum.discount.toFixed(2),
      total: pricing.sum.total.toFixed(2),
    }),
  );
}
export async function validateDiscountApproval(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof checkoutSchema>,
  pricing: any,
) {
  assert(
    input.discountApprovalId,
    "DISCOUNT_LIMIT",
    "Discount exceeds your authorized limit",
    403,
  );
  const approval = await tx.discountApproval.findUnique({
    where: { id: input.discountApprovalId },
  });
  assert(
    approval &&
      approval.requesterId === actor.id &&
      approval.status === "APPROVED" &&
      approval.expiresAt > new Date(),
    "DISCOUNT_APPROVAL_INVALID",
    "Discount approval is missing, expired or already used",
    403,
  );
  assert(
    approval.fingerprint === approvalFingerprint(actor, input, pricing),
    "DISCOUNT_APPROVAL_CHANGED",
    "The cart or prices changed; request approval again",
    409,
  );
  const approver = await approvalActor(tx, approval.approverId!);
  assert(
    approver.permissions.includes("sales.discount_approve") &&
      pricing.percent.lte(approver.discountLimit),
    "DISCOUNT_APPROVAL_INVALID",
    "Approver no longer has sufficient authority",
    403,
  );
  return approval;
}
