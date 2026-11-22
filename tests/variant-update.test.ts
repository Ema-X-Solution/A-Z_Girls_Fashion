import { describe, expect, it } from "vitest";
import { updateVariantSchema } from "../apps/api/src/validators/variant-update.validation";

describe("variant price/minimum-stock PATCH", () => {
  it("keeps omitted fields absent, including a deliberate zero price", () => {
    expect(updateVariantSchema.parse({ price: "150.00" })).toEqual({
      price: "150.00",
    });
    expect(updateVariantSchema.parse({ minStock: 9 })).toEqual({ minStock: 9 });
    expect(updateVariantSchema.parse({ price: "0", minStock: 0 })).toEqual({
      price: "0",
      minStock: 0,
    });
  });
  it("rejects empty requests and fields outside the price permission", () => {
    for (const body of [
      {},
      { cost: "0" },
      { price: "10", options: {} },
      { minStock: 2, active: false },
      { price: "10", sku: "REPLACED" },
      { price: "10", barcode: "123456" },
      { reorderQuantity: 1 },
    ])
      expect(updateVariantSchema.safeParse(body).success).toBe(false);
  });
  it("rejects invalid prices and non-integer minimum stock", () => {
    for (const body of [
      { price: "-1" },
      { price: "1.234" },
      { price: 10 },
      { minStock: -1 },
      { minStock: 1.5 },
      { minStock: null },
    ])
      expect(updateVariantSchema.safeParse(body).success).toBe(false);
  });
});
