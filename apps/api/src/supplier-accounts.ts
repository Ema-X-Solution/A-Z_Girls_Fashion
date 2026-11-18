import { z } from "zod";
import { id, money, paymentMethods } from "@az/shared";
import { type Tx, assert, audit } from "./db.js";
import { type Actor } from "./auth.js";
import { D, returnAmount, round } from "./money.js";
import { activeShift, stock } from "./operations.js";

export async function lockSupplier(tx: Tx, supplierId: string) {
  await tx.$queryRaw`SELECT id FROM "Supplier" WHERE id=${supplierId}::uuid FOR UPDATE`;
  const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
  assert(supplier, "NOT_FOUND", "Supplier not found", 404);
  return supplier;
}
export async function supplierBalance(tx: Tx, supplierId: string) {
  const supplier = await tx.supplier.findUniqueOrThrow({
    where: { id: supplierId },
  });
  const invoices = await tx.supplierInvoice.aggregate({
      where: { supplierId },
      _sum: { total: true },
    }),
    payments = await tx.supplierPayment.aggregate({
      where: { supplierId },
      _sum: { amount: true },
    }),
    credits = await tx.purchaseReturn.aggregate({
      where: { supplierId },
      _sum: { total: true },
    });
  const invoiced = invoices._sum.total ?? D(0),
    paid = payments._sum.amount ?? D(0),
    returned = credits._sum.total ?? D(0);
  return {
    openingBalance: supplier.openingBalance.toFixed(2),
    invoiced: invoiced.toFixed(2),
    paid: paid.toFixed(2),
    returned: returned.toFixed(2),
    balance: supplier.openingBalance
      .plus(invoiced)
      .minus(paid)
      .minus(returned)
      .toFixed(2),
  };
}
export async function supplierList(
  tx: Tx,
  q: string,
  pagination: { take: number; skip: number },
  financial: boolean,
) {
  const where = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { phone: { contains: q } },
        ],
      }
    : {};
  const suppliers = await tx.supplier.findMany({
      where,
      ...pagination,
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    total = await tx.supplier.count({ where }),
    ids = suppliers.map((s) => s.id);
  if (!financial)
    return {
      data: suppliers.map(({ openingBalance: _balance, ...s }) => s),
      total,
    };
  const invoices = await tx.supplierInvoice.groupBy({
      by: ["supplierId"],
      where: { supplierId: { in: ids } },
      _sum: { total: true },
    }),
    payments = await tx.supplierPayment.groupBy({
      by: ["supplierId"],
      where: { supplierId: { in: ids } },
      _sum: { amount: true },
    }),
    credits = await tx.purchaseReturn.groupBy({
      by: ["supplierId"],
      where: { supplierId: { in: ids } },
      _sum: { total: true },
    });
  return {
    data: suppliers.map((s) => ({
      ...s,
      currentBalance: s.openingBalance
        .plus(invoices.find((i) => i.supplierId === s.id)?._sum.total ?? 0)
        .minus(payments.find((p) => p.supplierId === s.id)?._sum.amount ?? 0)
        .minus(credits.find((c) => c.supplierId === s.id)?._sum.total ?? 0)
        .toFixed(2),
    })),
    total,
  };
}
export const supplierPaymentSchema = z.object({
  amount: money.refine((v) => D(v).gt(0)),
  method: z.enum(paymentMethods),
  shiftId: id.optional(),
  reference: z.string().max(200).default(""),
  notes: z.string().max(1000).default(""),
});
export async function paySupplier(
  tx: Tx,
  actor: Actor,
  supplierId: string,
  input: z.infer<typeof supplierPaymentSchema>,
) {
  if (input.method === "CASH") {
    assert(
      input.shiftId,
      "SHIFT_REQUIRED",
      "Cash supplier payment requires your open shift",
      400,
    );
    await activeShift(tx, input.shiftId, actor);
  } else
    assert(
      !input.shiftId,
      "NONCASH_SHIFT",
      "Noncash payment must not reference a drawer shift",
      400,
    );
  const supplier = await lockSupplier(tx, supplierId);
  assert(supplier.active, "SUPPLIER_INACTIVE", "Supplier is inactive");
  const balance = await supplierBalance(tx, supplierId);
  assert(
    D(input.amount).lte(balance.balance),
    "SUPPLIER_OVERPAYMENT",
    "Payment exceeds the outstanding supplier balance",
    400,
  );
  const payment = await tx.supplierPayment.create({
    data: { supplierId, ...input, createdBy: actor.id },
  });
  if (input.method === "CASH")
    await tx.cashMovement.create({
      data: {
        shiftId: input.shiftId!,
        userId: actor.id,
        type: "SUPPLIER_PAYMENT",
        amount: D(input.amount).negated(),
        reference: payment.id,
        reason: `Supplier payment: ${supplier.name}`,
      },
    });
  await audit(tx, actor.id, "SUPPLIER_PAYMENT", payment.id, {
    supplierId,
    amount: payment.amount.toFixed(2),
    method: input.method,
  });
  return payment;
}
export const purchaseReturnSchema = z
  .object({
    reason: z.string().min(3).max(1000),
    items: z
      .array(
        z.object({
          receiptItemId: id,
          quantity: z.number().int().positive().max(100000),
        }),
      )
      .min(1)
      .max(200),
  })
  .refine(
    (v) => new Set(v.items.map((i) => i.receiptItemId)).size === v.items.length,
    "Duplicate receipt items",
  );
export async function returnPurchase(
  tx: Tx,
  actor: Actor,
  invoiceId: string,
  input: z.infer<typeof purchaseReturnSchema>,
) {
  const invoice = await tx.supplierInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      receipt: {
        include: { purchase: true, items: { include: { purchaseItem: true } } },
      },
    },
  });
  assert(invoice, "NOT_FOUND", "Supplier invoice not found", 404);
  await lockSupplier(tx, invoice.supplierId);
  await tx.$queryRaw`SELECT id FROM "SupplierInvoice" WHERE id=${invoiceId}::uuid FOR UPDATE`;
  const returnId = crypto.randomUUID();
  let total = D(0);
  const lines = [];
  const inputs = input.items.map((line) => ({
    line,
    original: invoice.receipt.items.find((i) => i.id === line.receiptItemId),
  }));
  assert(
    inputs.every((i) => i.original),
    "INVALID_RECEIPT_ITEM",
    "Item does not belong to this invoice",
    400,
  );
  inputs.sort((a, b) =>
    a.original!.purchaseItem.variantId.localeCompare(
      b.original!.purchaseItem.variantId,
    ),
  );
  for (const { line, original } of inputs) {
    const item = original!;
    assert(
      line.quantity <= item.quantity - item.returned,
      "PURCHASE_RETURN_QUANTITY",
      "Return exceeds remaining received quantity",
    );
    const amount = returnAmount(
      item.lineTotal,
      item.quantity,
      item.returned,
      item.returnedAmount,
      line.quantity,
    );
    const cost = await stock(tx, actor, {
      variantId: item.purchaseItem.variantId,
      locationId: invoice.receipt.purchase.locationId,
      quantity: -line.quantity,
      type: "SUPPLIER_RETURN",
      reference: returnId,
      reason: input.reason,
    });
    await tx.purchaseReceiptItem.update({
      where: { id: item.id },
      data: {
        returned: { increment: line.quantity },
        returnedAmount: { increment: amount },
      },
    });
    lines.push({
      receiptItemId: item.id,
      quantity: line.quantity,
      amount,
      inventoryCost: cost.mul(line.quantity),
    });
    total = total.plus(amount);
  }
  const returned = await tx.purchaseReturn.create({
    data: {
      id: returnId,
      supplierId: invoice.supplierId,
      invoiceId,
      reason: input.reason,
      total: round(total),
      createdBy: actor.id,
      items: { create: lines },
    },
    include: { items: true },
  });
  await audit(tx, actor.id, "SUPPLIER_RETURN", returned.id, {
    supplierId: invoice.supplierId,
    invoiceId,
    total: total.toFixed(2),
  });
  return returned;
}

export async function supplierStatement(
  tx: Tx,
  supplierId: string,
  limit: number,
  offset: number,
) {
  const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
  assert(supplier, "NOT_FOUND", "Supplier not found", 404);
  const data = await tx.$queryRaw`
    WITH entries AS (
      SELECT id, 0 AS priority, "createdAt", 'OPENING'::text AS type, ''::text AS reference, 'Opening balance'::text AS description, "openingBalance" AS debit, 0::numeric AS credit FROM "Supplier" WHERE id=${supplierId}::uuid
      UNION ALL SELECT id,1,"createdAt",'INVOICE',number::text,'Purchase receipt invoice',total,0::numeric FROM "SupplierInvoice" WHERE "supplierId"=${supplierId}::uuid
      UNION ALL SELECT id,1,"createdAt",'PAYMENT',reference,notes,0::numeric,amount FROM "SupplierPayment" WHERE "supplierId"=${supplierId}::uuid
      UNION ALL SELECT id,1,"createdAt",'RETURN',number::text,reason,0::numeric,total FROM "PurchaseReturn" WHERE "supplierId"=${supplierId}::uuid
    ), ledger AS (SELECT *,SUM(debit-credit) OVER (ORDER BY priority,"createdAt",id ROWS UNBOUNDED PRECEDING) AS balance FROM entries)
    SELECT id,"createdAt",type,reference,description,debit,credit,balance FROM ledger ORDER BY priority,"createdAt",id LIMIT ${limit} OFFSET ${offset}`;
  const counts = await Promise.all([
    tx.supplierInvoice.count({ where: { supplierId } }),
    tx.supplierPayment.count({ where: { supplierId } }),
    tx.purchaseReturn.count({ where: { supplierId } }),
  ]);
  return {
    supplier,
    summary: await supplierBalance(tx, supplierId),
    entries: data,
    total: 1 + counts.reduce((a, b) => a + b, 0),
  };
}
