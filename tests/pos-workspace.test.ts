import { checkoutSchema } from "@az/shared";
import { describe, it, expect } from "vitest";
import {
  emptyWorkspace,
  saveWorkspace,
  readWorkspace,
  workspaceKey,
} from "../apps/web/src/features/pos/workspace";
const user = "11111111-1111-4111-8111-111111111111";
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
describe("durable POS journal", () => {
  it("preserves exact pre-upgrade pending bodies while rejecting retired shared-cart input for new sales", () => {
    const local = storage(),
      w = emptyWorkspace();
    const body = {
      shiftId: user,
      items: [
        {
          variantId: user,
          quantity: 1,
          discount: "0",
          discountType: "FIXED" as const,
        },
      ],
      discount: "0",
      discountType: "FIXED" as const,
      notes: "",
      payments: [
        {
          method: "CASH" as const,
          amount: "10",
          cardBrand: "",
          authorizationCode: "",
          cardLast4: "",
        },
      ],
      sharedCart: { id: user, revision: 1, token: "0".repeat(64) },
    };
    w.pending = { key: user, createdAt: new Date().toISOString(), body };
    saveWorkspace(local, user, w);
    expect(readWorkspace(local, user).pending?.body).toEqual(body);
    expect(checkoutSchema.safeParse(body).success).toBe(false);
  });
  it("keeps per-user drafts and exact pending tender without variant cost fields", () => {
    const local = storage(),
      w = emptyWorkspace();
    w.active.items = [
      {
        variant: {
          id: user,
          sku: "SKU",
          barcode: "123",
          price: "320.00",
          options: {},
          product: { nameAr: "قطعة" },
          cost: "90",
        } as any,
        quantity: 2,
      },
    ];
    w.active.discount = "50";
    w.active.loyaltyPoints = 5;
    w.pending = {
      key: user,
      createdAt: new Date().toISOString(),
      body: {
        loyaltyPoints: 5,
        shiftId: user,
        items: [
          {
            variantId: user,
            quantity: 2,
            discount: "0",
            discountType: "FIXED",
          },
        ],
        discount: "50",
        discountType: "FIXED",
        notes: "",
        payments: [
          {
            method: "CARD",
            amount: "590.00",
            cardBrand: "Visa",
            authorizationCode: "AUTH-12",
            cardLast4: "4321",
          },
        ],
      },
    };
    const clean = saveWorkspace(local, user, w);
    expect(readWorkspace(local, user)).toEqual(clean);
    expect(readWorkspace(local, "another-user")).toEqual(emptyWorkspace());
    expect(JSON.stringify(clean)).not.toContain('"cost"');
    expect(clean.pending?.body.payments[0].authorizationCode).toBe("AUTH-12");
    expect(clean.pending?.key).toBe(user);
    expect(clean.active.loyaltyPoints).toBe(5);
    expect(clean.pending?.body.loyaltyPoints).toBe(5);
    delete w.active.loyaltyPoints;
    delete w.pending.body.loyaltyPoints;
    const legacy = saveWorkspace(local, user, w);
    expect(legacy.pending?.body).not.toHaveProperty("loyaltyPoints");
  });
  it("does not silently replace unreadable journals or hide failed writes", () => {
    const local = storage();
    local.setItem(workspaceKey(user), "broken");
    expect(() => readWorkspace(local, user)).toThrow();
    expect(local.getItem(workspaceKey(user))).toBe("broken");
    expect(() =>
      saveWorkspace(
        {
          setItem: () => {
            throw new Error("Quota");
          },
        },
        user,
        emptyWorkspace(),
      ),
    ).toThrow("Quota");
  });
});
