import { z } from "zod";
import { checkoutSchema, defaultReturnPolicy } from "@az/shared";
import { type Tx, assert } from "./db.js";
import { type Actor } from "./auth.js";
import { D, allocate, round, totals } from "./money.js";
import { validateDiscountApproval } from "./discount-policy.js";
import { choosePromotion } from "./promotion-pricing.js";
import { loyaltyQuote } from "./loyalty.js";

export function discountAmount(
  base: ReturnType<typeof D>,
  value: string,
  type: string,
) {
  const amount = D(value);
  assert(
    type !== "PERCENT" || amount.lte(100),
    "INVALID_DISCOUNT",
    "Percentage exceeds 100",
    400,
  );
  const discount =
    type === "PERCENT" ? round(base.mul(amount).div(100)) : amount;
  assert(
    discount.gte(0) && discount.lte(base),
    "INVALID_DISCOUNT",
    "Discount exceeds the available line amount",
    400,
  );
  return discount;
}
export async function quoteSale(
  tx: Tx,
  actor: Actor,
  input: z.infer<typeof checkoutSchema>,
  options: { checkDiscount?: boolean } = {},
) {
  const ids = input.items.map((i) => i.variantId);
  assert(
    new Set(ids).size === ids.length,
    "DUPLICATE_ITEM",
    "Combine duplicate variant quantities",
    400,
  );
  const variants = await tx.productVariant.findMany({
    where: { id: { in: ids } },
    include: { product: { include: { category: true } } },
  });
  assert(
    variants.length === ids.length &&
      variants.every((v) => v.active && v.product.status === "ACTIVE"),
    "INVALID_PRODUCT",
    "Some products are inactive or unavailable",
  );
  const lines = input.items.map((i) => ({
    ...i,
    variant: variants.find((v) => v.id === i.variantId)!,
  }));
  const campaigns = await tx.promotion.findMany({
    where: {
      active: true,
      startsAt: { lte: new Date() },
      endsAt: { gt: new Date() },
    },
  });
  const promotion = choosePromotion(lines, campaigns);
  const weights = lines.map((l) => l.variant.price.mul(l.quantity)),
    afterPromotion = weights.map((w, i) =>
      w.minus(promotion?.allocations[i] ?? 0),
    ),
    itemDiscounts = lines.map((l, i) =>
      discountAmount(
        afterPromotion[i]!,
        l.discount ?? "0",
        l.discountType ?? "FIXED",
      ),
    );
  const afterItems = afterPromotion.map((w, i) => w.minus(itemDiscounts[i]!)),
    available = afterItems.reduce((s, v) => s.plus(v), D(0));
  const customer = input.customerId
    ? await tx.customer.findUnique({
        where: { id: input.customerId },
        select: { discountPercent: true },
      })
    : null;
  const customerDiscount = round(
    available.mul(customer?.discountPercent ?? 0).div(100),
  );
  const invoiceDiscount = discountAmount(
      available.minus(customerDiscount),
      input.discount,
      input.discountType ?? "FIXED",
    ),
    combinedDiscount = itemDiscounts.reduce(
      (s, v) => s.plus(v),
      invoiceDiscount,
    );
  const setting =
    ((await tx.systemSetting.findUnique({ where: { key: "store" } }))
      ?.value as Record<string, any>) ?? {};
  const taxMode = setting.taxMode === "INCLUSIVE" ? "INCLUSIVE" : "EXCLUSIVE",
    taxRate = String(setting.taxRate ?? "0");
  const loyalty = await loyaltyQuote(
    tx,
    input.customerId,
    input.loyaltyPoints ?? 0,
    available.minus(customerDiscount).minus(invoiceDiscount),
  );
  const sum = totals(
    lines.map((i) => ({
      price: i.variant.price.toString(),
      quantity: i.quantity,
    })),
    combinedDiscount
      .plus(promotion?.discount ?? 0)
      .plus(customerDiscount)
      .plus(loyalty.discount)
      .toFixed(2),
    taxRate,
    taxMode,
  );
  const manualBase = afterPromotion.reduce((s, v) => s.plus(v), D(0));
  const percent = manualBase.eq(0)
    ? D(0)
    : combinedDiscount.mul(100).div(manualBase);
  const approved =
    options.checkDiscount !== false && percent.gt(actor.discountLimit)
      ? await validateDiscountApproval(tx, actor, input, {
          lines,
          sum,
          percent,
          taxMode,
          taxRate,
          promotion: promotion?.snapshot ?? null,
        })
      : null;
  const invoiceAllocations = allocate(
      invoiceDiscount.plus(customerDiscount).plus(loyalty.discount),
      afterItems,
    ),
    discounts = itemDiscounts.map((v, i) =>
      v.plus(invoiceAllocations[i]!).plus(promotion?.allocations[i] ?? 0),
    ),
    taxes = allocate(
      sum.tax,
      weights.map((v, i) => v.minus(discounts[i]!)),
    );
  return {
    lines,
    weights,
    discounts,
    taxes,
    sum,
    setting,
    taxMode,
    taxRate,
    percent,
    approved,
    promotion: promotion?.snapshot ?? null,
    automaticDiscount: (promotion?.discount ?? D(0)).plus(customerDiscount),
    customerDiscount,
    manualDiscount: combinedDiscount,
    loyalty,
  };
}
export function receiptSettings(
  setting: Record<string, any>,
  branchName: string,
  cashier: { name: string; employeeCode: string | null; id: string },
  registerName: string,
) {
  const returnDays = Number(setting.returnDays ?? 14),
    policy = String(setting.returnPolicy ?? defaultReturnPolicy);
  return {
    name: String(setting.name ?? "A&Z Girls Fashion"),
    logoUrl: String(setting.logoUrl ?? "/brand/az-logo.jpg"),
    address: String(setting.address ?? ""),
    phone: String(setting.phone ?? ""),
    currency: String(setting.currency ?? "EGP"),
    timezone: String(setting.timezone ?? "Africa/Cairo"),
    branchName: String(setting.branchName || branchName),
    taxNumber: String(setting.taxNumber ?? ""),
    commercialRegister: String(setting.commercialRegister ?? ""),
    invoicePrefix: String(setting.invoicePrefix ?? "INV"),
    receiptWidth: Number(setting.receiptWidth ?? 80),
    receiptFooter: String(setting.receiptFooter ?? "شكراً لزيارتكم"),
    returnDays,
    returnPolicy:
      policy === defaultReturnPolicy
        ? policy.replace("14 يوماً", `${returnDays} يوماً`)
        : policy,
    cashierName: cashier.name,
    sellerCode: cashier.employeeCode || cashier.id.slice(0, 8).toUpperCase(),
    registerName,
  };
}
