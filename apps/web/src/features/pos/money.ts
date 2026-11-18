export function cents(value: unknown): bigint {
  const s = String(value ?? "0");
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return 0n;
  const [whole = "0", part = ""] = s.split(".");
  return BigInt(whole) * 100n + BigInt(part.padEnd(2, "0"));
}
export function decimal(value: bigint) {
  const negative = value < 0n;
  if (negative) value = -value;
  return `${negative ? "-" : ""}${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}
export function reduction(base: bigint, value: string, type: string) {
  const parsed = cents(value);
  return type === "PERCENT" ? (base * parsed + 5000n) / 10000n : parsed;
}
export function previewTotals(
  items: { variant: { price: string; id: string }; quantity: number }[],
  itemDiscounts: Record<string, { value: string; type: string }>,
  value: string,
  type: string,
  rate: string,
  mode: string,
) {
  const subtotal = items.reduce(
    (s, i) => s + cents(i.variant.price) * BigInt(i.quantity),
    0n,
  );
  const lineDiscount = items.reduce((s, i) => {
      const d = itemDiscounts[i.variant.id];
      return (
        s +
        (d
          ? reduction(
              cents(i.variant.price) * BigInt(i.quantity),
              d.value,
              d.type,
            )
          : 0n)
      );
    }, 0n),
    discount = lineDiscount + reduction(subtotal - lineDiscount, value, type),
    after = subtotal - discount;
  const denominator = 10000n + cents(rate),
    net =
      mode === "INCLUSIVE"
        ? (after * 10000n + denominator / 2n) / denominator
        : after,
    tax =
      mode === "INCLUSIVE"
        ? after - net
        : (after * cents(rate) + 5000n) / 10000n;
  return {
    subtotal,
    discount,
    net,
    tax,
    total: mode === "INCLUSIVE" ? after : after + tax,
  };
}
