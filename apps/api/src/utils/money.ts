import { Prisma } from "@prisma/client";
export const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const round = (v: Prisma.Decimal) =>
  v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
export function totals(
  prices: { price: string; quantity: number }[],
  discount: string,
  taxRate: string,
  taxMode: "INCLUSIVE" | "EXCLUSIVE" = "EXCLUSIVE",
) {
  const subtotal = prices.reduce(
    (s, i) => s.plus(D(i.price).mul(i.quantity)),
    D(0),
  );
  const reduction = D(discount);
  if (reduction.lt(0) || reduction.gt(subtotal))
    throw new Error("Invalid discount");
  const discounted = subtotal.minus(reduction);
  if (taxMode === "INCLUSIVE") {
    const netBeforeTax = round(discounted.div(D(1).plus(D(taxRate).div(100)))),
      tax = discounted.minus(netBeforeTax);
    return {
      subtotal,
      discount: reduction,
      tax,
      total: discounted,
      netBeforeTax,
    };
  }
  const tax = round(discounted.mul(taxRate).div(100));
  return {
    subtotal,
    discount: reduction,
    tax,
    total: discounted.plus(tax),
    netBeforeTax: discounted,
  };
}
// Largest-remainder allocation in integer cents, including zero-priced lines.
export function allocate(amount: Prisma.Decimal, weights: Prisma.Decimal[]) {
  const sum = weights.reduce((a, b) => a.plus(b), D(0));
  if (sum.eq(0)) return weights.map(() => D(0));
  const cents = amount.mul(100),
    exact = weights.map((w) => cents.mul(w).div(sum)),
    floors = exact.map((v) => v.floor());
  let remainder = cents
    .minus(floors.reduce((a, b) => a.plus(b), D(0)))
    .toNumber();
  const ranked = exact
    .map((v, i) => ({ i, fraction: v.minus(floors[i]!) }))
    .sort((a, b) => b.fraction.comparedTo(a.fraction) || a.i - b.i);
  for (const r of ranked) {
    if (remainder-- <= 0) break;
    floors[r.i] = floors[r.i]!.plus(1);
  }
  return floors.map((v) => v.div(100));
}
export function returnAmount(
  total: Prisma.Decimal,
  quantity: number,
  returned: number,
  refunded: Prisma.Decimal,
  requested: number,
) {
  if (
    requested < 1 ||
    !Number.isInteger(requested) ||
    requested > quantity - returned
  )
    throw new Error("Invalid return quantity");
  return returned + requested === quantity
    ? total.minus(refunded)
    : round(total.mul(requested).div(quantity));
}
