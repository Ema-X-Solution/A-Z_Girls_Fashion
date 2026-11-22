import { describe, expect, it } from "vitest";
import { checkoutSchema } from "@az/shared";
import { quoteSale } from "../apps/api/src/services/sale-pricing";
import { D } from "../apps/api/src/utils/money";

const id = "11111111-1111-4111-8111-111111111111";
const variantId = "22222222-2222-4222-8222-222222222222";
const actor = {
  id,
  name: "TEST Cashier",
  email: "cashier@example.test",
  roles: [],
  permissions: ["sales.create"],
  discountLimit: "100",
};
const input = (overrides = {}) =>
  checkoutSchema.parse({
    shiftId: id,
    customerId: id,
    items: [{ variantId, quantity: 1 }],
    discount: "0",
    payments: [{ method: "CASH", amount: "120" }],
    ...overrides,
  });
const tx = () => ({
  productVariant: {
    findMany: async () => [
      {
        id: variantId,
        price: D(120),
        active: true,
        product: { status: "ACTIVE", categoryId: id },
      },
    ],
  },
  promotion: { findMany: async () => [] },
  customer: { findUnique: async () => ({ discountPercent: D(5) }) },
  systemSetting: { findUnique: async () => null },
  loyaltyLot: { aggregate: async () => ({ _sum: { remaining: 0 } }) },
  loyaltyAccount: { findUnique: async () => null },
});

describe("manual sale discount permission", () => {
  it.each([
    { discount: "1" },
    { discount: "1", discountType: "PERCENT" },
    { items: [{ variantId, quantity: 1, discount: "1" }] },
    {
      items: [
        { variantId, quantity: 1, discount: "1", discountType: "PERCENT" },
      ],
    },
    { discount: "1", discountApprovalId: id },
  ])(
    "rejects unauthorized manual discount %j even with a 100 percent limit",
    async (discount) => {
      for (const checkDiscount of [true, false]) {
        await expect(
          quoteSale(tx() as any, actor, input(discount), { checkDiscount }),
        ).rejects.toMatchObject({
          status: 403,
          code: "DISCOUNT_FORBIDDEN",
          message: expect.stringMatching(/[\u0600-\u06ff]/),
        });
      }
    },
  );
  it("keeps automatic customer discounts available without manual-discount permission", async () => {
    const result = await quoteSale(tx() as any, actor, input());
    expect(result.manualDiscount.toFixed(2)).toBe("0.00");
    expect(result.customerDiscount.toFixed(2)).toBe("6.00");
    expect(result.sum.total.toFixed(2)).toBe("114.00");
  });
  it("allows authorized manual discounts and still enforces the account limit", async () => {
    const permitted = {
      ...actor,
      permissions: [...actor.permissions, "sales.discount"],
    };
    expect(
      (
        await quoteSale(tx() as any, permitted, input({ discount: "1" }))
      ).manualDiscount.toFixed(2),
    ).toBe("1.00");
    await expect(
      quoteSale(
        tx() as any,
        { ...permitted, discountLimit: "0" },
        input({ discount: "1" }),
      ),
    ).rejects.toMatchObject({ status: 403, code: "DISCOUNT_LIMIT" });
  });
});
