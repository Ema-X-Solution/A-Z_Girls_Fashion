import { D, allocate, round } from "../utils/money.js";
type Candidate = {
  id: string;
  name: string;
  type: string;
  productIds: unknown;
  percent: unknown;
  buyQuantity: number;
  getQuantity: number;
};
export function choosePromotion(lines: any[], campaigns: Candidate[]) {
  const weights = lines.map((l) => D(l.variant.price).mul(l.quantity));
  let best: {
    discount: ReturnType<typeof D>;
    allocations: ReturnType<typeof D>[];
    snapshot: any;
  } | null = null;
  for (const campaign of [...campaigns].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const products = campaign.productIds as string[];
    const eligible = lines
      .map((l, i) => ({ line: l, index: i }))
      .filter(
        ({ line }) =>
          !products.length || products.includes(line.variant.productId),
      );
    const base = eligible.reduce(
      (sum, { index }) => sum.plus(weights[index]!),
      D(0),
    );
    if (!base.gt(0)) continue;
    let discount = D(0);
    if (campaign.type === "PERCENT")
      discount = round(base.mul(D(String(campaign.percent))).div(100));
    else {
      let free =
        Math.floor(
          eligible.reduce((n, { line }) => n + line.quantity, 0) /
            (campaign.buyQuantity + campaign.getQuantity),
        ) * campaign.getQuantity;
      // Runs by line quantity, never expands a potentially large cart into units.
      for (const { line } of [...eligible].sort(
        (a, b) =>
          D(a.line.variant.price).cmp(b.line.variant.price) ||
          a.line.variantId.localeCompare(b.line.variantId),
      )) {
        const quantity = Math.min(free, line.quantity);
        discount = discount.plus(D(line.variant.price).mul(quantity));
        free -= quantity;
        if (!free) break;
      }
    }
    if (discount.gt(0) && (!best || discount.gt(best.discount))) {
      const allocations = allocate(
        discount,
        weights.map((v, i) => (eligible.some((e) => e.index === i) ? v : D(0))),
      );
      best = {
        discount,
        allocations,
        snapshot: {
          id: campaign.id,
          name: campaign.name,
          type: campaign.type,
          discount: discount.toFixed(2),
          returnRule:
            campaign.type === "BUY_X_GET_Y" ? "FULL_BUNDLE" : "PAID_VALUE",
          eligibleVariantIds: eligible.map((e) => e.line.variantId),
          buyQuantity: campaign.buyQuantity,
          getQuantity: campaign.getQuantity,
          percent: String(campaign.percent),
        },
      };
    }
  }
  return best;
}
