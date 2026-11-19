import { Prisma } from "@prisma/client";
import { z } from "zod";
import { id, money, paymentMethods } from "@az/shared";
import { audit, assert, json, transaction, type Tx } from "./db.js";
import { digest, type Actor } from "./auth.js";
import { allocate, D, round } from "./money.js";

export async function once(
  actor: Actor,
  key: string | undefined,
  operation: string,
  input: unknown,
  fn: (tx: Tx) => Promise<unknown>,
) {
  assert(
    key && /^[\w-]{16,100}$/.test(key),
    "IDEMPOTENCY_REQUIRED",
    "Supply an Idempotency-Key of 16–100 characters",
    400,
  );
  const scoped = digest(`${actor.id}:${operation}:${key}`),
    hash = digest(JSON.stringify(input));
  return transaction(async (tx) => {
    // Serializes duplicate submissions, including concurrent first submissions.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scoped}, 0))`;
    const existing = await tx.idempotencyKey.findUnique({
      where: { key: scoped },
    });
    if (existing) {
      assert(
        !(existing.response as any)?.checkoutCancelled,
        "CHECKOUT_CANCELLED",
        "This checkout attempt was cancelled; start a new attempt",
      );
      assert(
        existing.hash === hash,
        "IDEMPOTENCY_CONFLICT",
        "Key already used for a different request",
      );
      return existing.response;
    }
    const result = json(await fn(tx));
    await tx.idempotencyKey.create({
      data: {
        key: scoped,
        userId: actor.id,
        operation,
        hash,
        response: result,
      },
    });
    return result;
  });
}
export async function stock(
  tx: Tx,
  actor: Actor,
  input: {
    variantId: string;
    locationId: string;
    quantity: number;
    type: string;
    reference: string;
    reason: string;
    cost?: Prisma.Decimal;
  },
) {
  const { variantId, locationId, quantity } = input;
  await tx.stockBalance.upsert({
    where: { variantId_locationId: { variantId, locationId } },
    create: { variantId, locationId },
    update: {},
  });
  await tx.$queryRaw`SELECT "quantity" FROM "StockBalance" WHERE "variantId"=${variantId}::uuid AND "locationId"=${locationId}::uuid FOR UPDATE`;
  const balance = await tx.stockBalance.findUniqueOrThrow({
    where: { variantId_locationId: { variantId, locationId } },
  });
  if (quantity < 0) {
    const reserved =
      (
        await tx.cartReservation.aggregate({
          where: { variantId, locationId, expiresAt: { gt: new Date() } },
          _sum: { quantity: true },
        })
      )._sum.quantity ?? 0;
    assert(
      balance.quantity + quantity >= reserved,
      "STOCK_RESERVED",
      "الكمية محجوزة في سلة مشتركة",
    );
  }
  assert(
    balance.quantity + quantity >= 0,
    "INSUFFICIENT_STOCK",
    "Insufficient stock",
  );
  const averageCost =
    quantity > 0 && input.cost
      ? D(balance.averageCost)
          .mul(balance.quantity)
          .plus(input.cost.mul(quantity))
          .div(balance.quantity + quantity)
          .toDecimalPlaces(4)
      : balance.averageCost;
  await tx.stockBalance.update({
    where: { variantId_locationId: { variantId, locationId } },
    data: { quantity: { increment: quantity }, averageCost },
  });
  await tx.stockMovement.create({
    data: {
      variantId,
      locationId,
      quantity,
      type: input.type,
      reference: input.reference,
      reason: input.reason,
      unitCost: input.cost ?? balance.averageCost,
      userId: actor.id,
    },
  });
  return balance.averageCost;
}
export async function activeShift(
  tx: Tx,
  shiftId: string,
  actor: Actor,
  own = true,
) {
  await tx.$queryRaw`SELECT "id" FROM "CashShift" WHERE "id"=${shiftId}::uuid FOR UPDATE`;
  const shift = await tx.cashShift.findUnique({
    where: { id: shiftId },
    include: { register: true },
  });
  assert(shift && !shift.closedAt, "SHIFT_CLOSED", "An open shift is required");
  assert(
    !own || shift.userId === actor.id,
    "SHIFT_OWNER",
    "Use your own shift",
    403,
  );
  return shift;
}
export const receiveSchema = z.object({
  items: z
    .array(
      z.object({ purchaseItemId: id, quantity: z.number().int().positive() }),
    )
    .min(1),
});
export async function receive(
  tx: Tx,
  actor: Actor,
  purchaseId: string,
  input: z.infer<typeof receiveSchema>,
) {
  await tx.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "id"=${purchaseId}::uuid FOR UPDATE`;
  const purchase = await tx.purchaseOrder.findUnique({
    where: { id: purchaseId },
    include: { items: true },
  });
  assert(
    purchase && ["APPROVED", "PARTIAL"].includes(purchase.status),
    "PURCHASE_STATUS",
    "Purchase must be approved",
  );
  await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id=${purchase.supplierId}::uuid FOR UPDATE`;
  assert(
    new Set(input.items.map((i) => i.purchaseItemId)).size ===
      input.items.length,
    "DUPLICATE_ITEM",
    "Duplicate receipt item",
    400,
  );
  const receiptId = crypto.randomUUID();
  let total = D(0);
  const items: {
    purchaseItemId: string;
    quantity: number;
    unitCost: Prisma.Decimal;
  }[] = [];
  for (const line of input.items.sort((a, b) =>
    a.purchaseItemId.localeCompare(b.purchaseItemId),
  )) {
    const item = purchase.items.find((i) => i.id === line.purchaseItemId);
    assert(
      item && line.quantity <= item.quantity - item.received,
      "RECEIVE_QUANTITY",
      "Receiving exceeds outstanding quantity",
    );
    await stock(tx, actor, {
      variantId: item.variantId,
      locationId: purchase.locationId,
      quantity: line.quantity,
      cost: item.unitCost,
      type: "PURCHASE_RECEIPT",
      reference: receiptId,
      reason: "Purchase receiving",
    });
    await tx.purchaseOrderItem.update({
      where: { id: item.id },
      data: { received: { increment: line.quantity } },
    });
    total = total.plus(item.unitCost.mul(line.quantity));
    items.push({ ...line, unitCost: item.unitCost });
  }
  const lineTotals = allocate(
    round(total),
    items.map((i) => i.unitCost.mul(i.quantity)),
  );
  const receipt = await tx.purchaseReceipt.create({
    data: {
      id: receiptId,
      purchaseId,
      total: round(total),
      createdBy: actor.id,
      items: {
        create: items.map((item, index) => ({
          ...item,
          lineTotal: lineTotals[index]!,
        })),
      },
    },
  });
  await tx.supplierInvoice.create({
    data: {
      supplierId: purchase.supplierId,
      receiptId: receipt.id,
      total: receipt.total,
      createdBy: actor.id,
    },
  });
  const all = await tx.purchaseOrderItem.findMany({ where: { purchaseId } });
  await tx.purchaseOrder.update({
    where: { id: purchaseId },
    data: {
      status: all.every((i) => i.received === i.quantity)
        ? "RECEIVED"
        : "PARTIAL",
    },
  });
  await audit(tx, actor.id, "PURCHASE_RECEIVE", receipt.id, { purchaseId });
  return receipt;
}
export const expenseSchema = z.object({
  category: z.string().min(1).max(100),
  amount: money.refine((v) => D(v).gt(0)),
  method: z.enum(paymentMethods),
  description: z.string().min(3).max(1000),
  shiftId: id.optional(),
});

export { checkout } from "./sale-checkout.js";
export { returnSchema, refund } from "./sale-returns.js";
