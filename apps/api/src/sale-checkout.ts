import { Prisma } from "@prisma/client";
import { z } from "zod";
import { checkoutSchema } from "@az/shared";
import { type Tx, assert, audit } from "./db.js";
import { type Actor } from "./auth.js";
import { activeShift, stock } from "./operations.js";
import { D } from "./money.js";
import { quoteSale, receiptSettings } from "./sale-pricing.js";
import { lockLoyalty, postLoyaltySale } from "./loyalty.js";
export async function checkout(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof checkoutSchema>,
  options: { exchangeCredit?: Prisma.Decimal } = {},
) {
  assert(
    !input.requireCustomer || input.customerId,
    "CUSTOMER_REQUIRED",
    "حدد رقم العميل قبل إتمام البيع، حتى مع الدفع النقدي",
    400,
  );
  const shift = await activeShift(tx, input.shiftId, actor);
  if (input.customerId) await lockLoyalty(tx, input.customerId);
  const pricing = await quoteSale(tx, actor, input);
  const { lines, weights, discounts, taxes, sum, setting, taxMode, taxRate } =
      pricing,
    credit = options.exchangeCredit ?? D(0);
  assert(
    credit.gte(0) && credit.lte(sum.total),
    "INVALID_EXCHANGE_CREDIT",
    "Invalid internal exchange credit",
    400,
  );
  const paid = input.payments.reduce((s, p) => s.plus(p.amount), credit);
  assert(
    paid.gte(sum.total),
    "PAYMENT_INSUFFICIENT",
    "Payment is insufficient",
    400,
  );
  const change = paid.minus(sum.total),
    cash = input.payments
      .filter((p) => p.method === "CASH")
      .reduce((s, p) => s.plus(p.amount), D(0));
  assert(
    change.lte(cash),
    "INVALID_CHANGE",
    "Overpayment is only allowed in cash",
    400,
  );
  const saleId = crypto.randomUUID(),
    items = [];
  for (const [i, line] of [...lines.entries()].sort((a, b) =>
    a[1].variantId.localeCompare(b[1].variantId),
  )) {
    const cost = await stock(tx, actor, {
      variantId: line.variantId,
      locationId: shift.register.locationId,
      quantity: -line.quantity,
      type: "SALE",
      reference: saleId,
      reason: "Checkout",
    });
    items.push({
      variantId: line.variantId,
      name: line.variant.product.nameAr,
      options: line.variant.options as Prisma.InputJsonValue,
      barcode: line.variant.barcode,
      sku: line.variant.sku,
      returnRule: line.variant.product.returnRule,
      unitPrice: line.variant.price,
      unitCost: cost,
      quantity: line.quantity,
      discount: discounts[i]!,
      tax: taxes[i]!,
      total: weights[i]!.minus(discounts[i]!).plus(
        taxMode === "INCLUSIVE" ? 0 : taxes[i]!,
      ),
    });
  }
  const cashier = await tx.user.findUniqueOrThrow({
    where: { id: actor.id },
    select: { id: true, name: true, employeeCode: true },
  });
  const branch = await tx.branch.findUniqueOrThrow({
      where: { id: shift.register.branchId },
    }),
    snapshot = receiptSettings(
      setting,
      branch.name,
      cashier,
      shift.register.name,
    ),
    createdAt = new Date();
  const sale = await tx.sale.create({
    data: {
      id: saleId,
      userId: actor.id,
      branchId: branch.id,
      shiftId: shift.id,
      customerId: input.customerId,
      notes: input.notes,
      ...sum,
      taxMode,
      taxRate,
      receiptSnapshot: { ...snapshot, promotion: pricing.promotion },
      change,
      createdAt,
      items: { create: items },
      payments: {
        create: [
          ...input.payments
            .filter((p) => D(p.amount).gt(0))
            .map((p) => ({ ...p })),
          ...(credit.gt(0)
            ? [
                {
                  method: "EXCHANGE_CREDIT",
                  amount: credit.toFixed(2),
                  cardBrand: "",
                  authorizationCode: "",
                  cardLast4: "",
                },
              ]
            : []),
        ],
      },
    },
    include: { items: true, payments: true, user: { select: { name: true } } },
  });
  const year = new Intl.DateTimeFormat("en", {
      year: "numeric",
      timeZone: snapshot.timezone,
    }).format(createdAt),
    receiptNumber = `${snapshot.invoicePrefix}-${year}-${sale.number.toString().padStart(5, "0")}`;
  const loyalty = await postLoyaltySale(
    tx,
    input.customerId,
    sale.id,
    pricing.loyalty,
    sum.netBeforeTax,
  );
  const receiptSnapshot = {
    ...snapshot,
    promotion: pricing.promotion,
    loyalty:
      pricing.loyalty.settings.enabled && input.customerId ? loyalty : null,
  };
  await tx.sale.update({
    where: { id: sale.id },
    data: { receiptNumber, receiptSnapshot },
  });
  if (cash.gt(0))
    await tx.cashMovement.create({
      data: {
        shiftId: shift.id,
        userId: actor.id,
        type: "SALE",
        amount: cash.minus(change),
        reference: sale.id,
        reason: "Cash sale",
      },
    });
  if (pricing.approved) {
    const consumed = await tx.discountApproval.updateMany({
      where: {
        id: pricing.approved.id,
        status: "APPROVED",
        consumedSaleId: null,
      },
      data: { status: "CONSUMED", consumedSaleId: sale.id },
    });
    assert(
      consumed.count === 1,
      "DISCOUNT_APPROVAL_USED",
      "Approval already used",
      409,
    );
    await audit(tx, actor.id, "DISCOUNT_APPROVAL_USED", sale.id, {
      approvalId: pricing.approved.id,
      approverId: pricing.approved.approverId,
      discount: sum.discount.toFixed(2),
    });
  }
  await audit(tx, actor.id, "SALE", sale.id, {
    total: sum.total.toFixed(2),
    taxMode,
    taxRate,
    receiptNumber,
  });
  return { ...sale, receiptNumber, receiptSnapshot };
}
