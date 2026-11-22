import { describe, it, expect } from "vitest";
import { choosePromotion } from "../apps/api/src/services/promotion-pricing";
const row = (id: string, price: string, quantity: number) => ({
  variantId: id,
  quantity,
  variant: { price, productId: "product" },
});
const bundle = {
  id: "bundle",
  name: "Buy two get one",
  type: "BUY_X_GET_Y",
  productIds: [],
  percent: "0",
  buyQuantity: 2,
  getQuantity: 1,
};
describe("automatic campaign allocation", () => {
  it("selects the best single offer and allocates every cent without expanding units", () => {
    const lines = [row("a", "100", 2), row("b", "80", 1)];
    const offer = choosePromotion(lines, [
      bundle,
      { ...bundle, id: "percent", type: "PERCENT", percent: "25" },
    ])!;
    expect(offer.snapshot.id).toBe("bundle");
    expect(offer.discount.toFixed(2)).toBe("80.00");
    expect(offer.allocations.map((d) => d.toFixed(2))).toEqual([
      "57.14",
      "22.86",
    ]);
    expect(
      choosePromotion([row("a", "1", 1000000)], [bundle])!.discount.toFixed(2),
    ).toBe("333333.00");
  });
  it("honors product eligibility, quantity threshold, repeat groups and deterministic ties", () => {
    expect(choosePromotion([row("a", "100", 2)], [bundle])).toBeNull();
    expect(
      choosePromotion(
        [row("a", "100", 3)],
        [{ ...bundle, productIds: ["other"] }],
      ),
    ).toBeNull();
    expect(
      choosePromotion([row("a", "0.01", 6)], [bundle])!.discount.toFixed(2),
    ).toBe("0.02");
    expect(
      choosePromotion([row("a", "100", 3)], [{ ...bundle, id: "z" }, bundle])!
        .snapshot.id,
    ).toBe("bundle");
  });
});
