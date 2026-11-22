import { describe, it, expect } from "vitest";
import {
  D,
  totals,
  allocate,
  returnAmount,
} from "../apps/api/src/utils/money.js";
import {
  checkoutSchema,
  roleDefaults,
  permissions,
} from "../packages/shared/src/index.js";
describe("exact decimal accounting", () => {
  it("extracts included VAT from the requested invoice example", () => {
    const result = totals(
      [
        { price: "320", quantity: 2 },
        { price: "450", quantity: 1 },
      ],
      "50",
      "14",
      "INCLUSIVE",
    );
    expect(result.subtotal.toFixed(2)).toBe("1090.00");
    expect(result.netBeforeTax.toFixed(2)).toBe("912.28");
    expect(result.tax.toFixed(2)).toBe("127.72");
    expect(result.total.toFixed(2)).toBe("1040.00");
  });
  it("recalculates decimal prices, discounts and taxes", () => {
    const v = totals(
      [
        { price: "0.10", quantity: 3 },
        { price: "199.99", quantity: 2 },
      ],
      "10.01",
      "14",
    );
    expect(v.subtotal.toFixed(2)).toBe("400.28");
    expect(v.total.toFixed(2)).toBe("444.91");
  });
  it("rejects discounts larger than subtotal", () =>
    expect(() => totals([{ price: "5", quantity: 1 }], "6", "0")).toThrow());
  it("allocates cents exactly without negative zero-value lines", () => {
    const parts = allocate(D("0.02"), [D(1), D(1), D(1), D(0)]);
    expect(parts.map((p) => p.toFixed(2))).toEqual([
      "0.01",
      "0.01",
      "0.00",
      "0.00",
    ]);
    expect(parts.reduce((a, b) => a.plus(b), D(0)).toFixed(2)).toBe("0.02");
  });
  it("refunds final rounding remainder exactly", () => {
    const first = returnAmount(D(10), 3, 0, D(0), 1);
    const last = returnAmount(D(10), 3, 2, D("6.66"), 1);
    expect(first.toFixed(2)).toBe("3.33");
    expect(last.toFixed(2)).toBe("3.34");
  });
  it("allocates repeated tiny partial returns cumulatively without overrefunds", () => {
    for (let quantity = 1; quantity <= 20; quantity++) {
      for (let centTotal = 0; centTotal <= 25; centTotal++) {
        const total = D(centTotal).div(100);
        let refunded = D(0);
        for (let returned = 0; returned < quantity; returned++) {
          const amount = returnAmount(total, quantity, returned, refunded, 1);
          expect(amount.gte(0)).toBe(true);
          refunded = refunded.plus(amount);
          expect(refunded.lte(total)).toBe(true);
        }
        expect(refunded.eq(total)).toBe(true);
      }
    }
  });
  it("keeps historical partial refunds bounded when earlier rounding ran ahead", () => {
    expect(returnAmount(D("0.02"), 4, 2, D("0.02"), 1).toFixed(2)).toBe("0.00");
    expect(returnAmount(D("315.35"), 3, 2, D("210.24"), 1).toFixed(2)).toBe(
      "105.11",
    );
  });
  it("rejects excess returns", () =>
    expect(() => returnAmount(D(10), 3, 2, D("6.66"), 2)).toThrow());
  it("never permits floating point monetary input", () =>
    expect(checkoutSchema.safeParse({ discount: 0.3 }).success).toBe(false));
  it("keeps sensitive permissions away from cashier defaults", () => {
    expect(roleDefaults.CASHIER).not.toContain("reports.profit");
    expect(roleDefaults.CASHIER).not.toContain("products.change_price");
    expect(roleDefaults.OWNER).toEqual(permissions);
  });
});
