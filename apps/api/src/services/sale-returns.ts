import { originalSlices } from "./fifo.js";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { id, paymentMethods } from "@az/shared";
import { type Tx, assert, audit } from "../lib/db.js";
import { type Actor } from "../middleware/auth.js";
import { activeShift, stock } from "./operations.js";
import { D, returnAmount, round } from "../utils/money.js";
import { reverseLoyalty } from "./loyalty.js";
export const returnSchema = z.object({
  shiftId: id,
  reason: z.string().min(3).max(1000),
  reasonType: z
    .enum(["CHANGE_MIND", "MANUFACTURING_DEFECT"])
    .default("CHANGE_MIND"),
  method: z.enum(paymentMethods),
  items: z
    .array(
      z.object({
        saleItemId: id,
        quantity: z.number().int().positive(),
        sellable: z.boolean(),
      }),
    )
    .min(1)
    .max(200),
});
export async function quoteReturn(
  tx: Tx,
  saleId: string,
  input: z.infer<typeof returnSchema>,
) {
  const sale = await tx.sale.findUnique({
    where: { id: saleId },
    include: { items: true, shift: { include: { register: true } } },
  });
  assert(sale, "NOT_FOUND", "Sale not found", 404);
  const snapshot = sale.receiptSnapshot as Record<string, any>,
    setting =
      ((await tx.systemSetting.findUnique({ where: { key: "store" } }))
        ?.value as Record<string, any>) ?? {};
  assert(
    Date.now() - sale.createdAt.getTime() <=
      Number(snapshot.returnDays ?? setting.returnDays ?? 14) * 86400000,
    "RETURN_PERIOD",
    "Return period has expired",
  );
  assert(
    new Set(input.items.map((i) => i.saleItemId)).size === input.items.length,
    "DUPLICATE_ITEM",
    "Duplicate return item",
    400,
  );
  if (snapshot.promotion?.returnRule === "FULL_BUNDLE") {
    const eligible = sale.items.filter((i) =>
      (snapshot.promotion.eligibleVariantIds as string[]).includes(i.variantId),
    );
    if (input.items.some((i) => eligible.some((e) => e.id === i.saleItemId))) {
      assert(
        eligible.every(
          (i) =>
            i.returned === i.quantity ||
            input.items.some(
              (r) =>
                r.saleItemId === i.id && r.quantity === i.quantity - i.returned,
            ),
        ),
        "PROMOTION_RETURN_GROUP",
        "يجب إرجاع أو استبدال جميع الأصناف المتبقية من العرض معًا بالقيمة المدفوعة.",
        409,
      );
    }
  }
  const lines = input.items.map((line) => {
    const original = sale.items.find((i) => i.id === line.saleItemId);
    assert(original, "INVALID_ITEM", "Item does not belong to invoice", 400);
    assert(
      line.quantity <= original.quantity - original.returned,
      "RETURN_QUANTITY",
      "Return exceeds eligible quantity",
    );
    assert(
      original.returnRule !== "DEFECT_ONLY" ||
        input.reasonType === "MANUFACTURING_DEFECT",
      "DEFECT_ONLY_RETURN",
      "This item may only be returned for a manufacturing defect",
      403,
    );
    return {
      line,
      original,
      amount: returnAmount(
        original.total,
        original.quantity,
        original.returned,
        original.refunded,
        line.quantity,
      ),
    };
  });
  return { sale, lines, total: lines.reduce((s, i) => s.plus(i.amount), D(0)) };
}
export async function refund(
  tx: Tx,
  actor: Actor,
  saleId: string,
  input: z.infer<typeof returnSchema>,
  options: { exchangeTotal?: Prisma.Decimal } = {},
) {
  const shift = await activeShift(tx, input.shiftId, actor);
  await tx.$queryRaw`SELECT id FROM "Sale" WHERE id=${saleId}::uuid FOR UPDATE`;
  const { sale, lines, total } = await quoteReturn(tx, saleId, input);
  assert(
    sale.branchId === shift.register.branchId,
    "WRONG_BRANCH",
    "Return must use the original branch",
  );
  const returnId = crypto.randomUUID(),
    items = [];
  for (const { line, original, amount } of lines.sort((a, b) =>
    a.original.variantId.localeCompare(b.original.variantId),
  )) {
    const targetTax = original.total.eq(0)
        ? D(0)
        : round(
            original.refunded
              .plus(amount)
              .mul(original.tax)
              .div(original.total),
          ),
      tax = targetTax.minus(original.refundedTax);
    const history = await tx.stockCostFlow.count({ where: {reference: saleId, type: "SALE", variantId:original.variantId} });
    const layers = history ? await originalSlices(tx, saleId, "SALE", original.variantId, original.returned, line.quantity) : [{quantity:line.quantity, unitCost: original.unitCost, acquiredAt: sale.createdAt}];
    const returnCost = layers.reduce((sum, layer) => sum.plus(layer.unitCost.mul(layer.quantity)), D(0));
    await tx.saleItem.update({
      where: { id: original.id },
      data: {
        returned: { increment: line.quantity },
        refunded: { increment: amount },
        refundedTax: { increment: tax },
      },
    });
    if (line.sellable)
      await stock(tx, actor, {
        variantId: original.variantId,
        locationId: sale.shift.register.locationId,
        quantity: line.quantity,
        cost: original.unitCost,
        layers,
        type: "SALE_RETURN",
        reference: returnId,
        reason: input.reason,
      });
    items.push({
      ...line,
      amount,
      tax,
      cost: returnCost,
    });
  }
  const creditAmount =
      options.exchangeTotal !== undefined
        ? Prisma.Decimal.min(total, options.exchangeTotal)
        : D(0),
    refundAmount = total.minus(creditAmount),
    method =
      options.exchangeTotal !== undefined && refundAmount.eq(0)
        ? "EXCHANGE_CREDIT"
        : input.method;
  const returned = await tx.saleReturn.create({
    data: {
      id: returnId,
      saleId,
      shiftId: shift.id,
      createdBy: actor.id,
      reason: input.reason,
      reasonType: input.reasonType,
      method,
      total,
      refundAmount,
      creditAmount,
      items: { create: items },
    },
    include: { items: true },
  });
  const updated = await tx.saleItem.findMany({ where: { saleId } });
  const loyalty = await reverseLoyalty(tx, sale, returnId);
  await tx.sale.update({
    where: { id: saleId },
    data: {
      status: updated.every((i) => i.returned === i.quantity)
        ? "FULLY_RETURNED"
        : "PARTIALLY_RETURNED",
    },
  });
  if (input.method === "CASH" && refundAmount.gt(0))
    await tx.cashMovement.create({
      data: {
        shiftId: shift.id,
        userId: actor.id,
        type: "REFUND",
        amount: refundAmount.negated(),
        reference: returnId,
        reason: input.reason,
      },
    });
  await audit(tx, actor.id, "REFUND", returnId, {
    saleId,
    total: total.toFixed(2),
    refundAmount: refundAmount.toFixed(2),
    creditAmount: creditAmount.toFixed(2),
  });
  return {
    ...returned,
    loyalty,
    originalSale: {
      id: sale.id,
      number: sale.number,
      receiptNumber: sale.receiptNumber,
      createdAt: sale.createdAt,
      receiptSnapshot: sale.receiptSnapshot,
      items: sale.items,
    },
  };
}
