import { describe, it, expect } from "vitest";
import {
  customerPhoneKey,
  customerPhoneSchema,
  customerPhoneSearch,
} from "../packages/shared/src/customer-phone";
describe("customer phone capture", () => {
  it("matches domestic, international and Arabic-digit representations", () => {
    for (const phone of [
      "01069017890",
      "+20 10 69017890",
      "00201069017890",
      "١٠٦٩٠١٧٨٩٠",
      "۰۱۰۶۹۰۱۷۸۹۰",
      "\u200e+20 10 69017890\u200e",
    ]) {
      expect(customerPhoneKey(phone)).toBe("201069017890");
      expect(customerPhoneSchema.parse(phone)).toBe("+201069017890");
    }
    expect(customerPhoneSchema.parse("+49 (151) 12345678")).toBe(
      "+4915112345678",
    );
  });
  it("rejects incomplete Egyptian numbers, letters and overlong numbers", () => {
    for (const phone of [
      "010",
      "01012345",
      "+20 10",
      "Call 01069017890",
      "+1234567890123456",
      "",
    ])
      expect(customerPhoneSchema.safeParse(phone).success).toBe(false);
    expect(customerPhoneSearch("٠١٠٦")).toBe("0106");
    expect(customerPhoneSearch("0178")).toBe("0178");
    expect(customerPhoneSearch("٦٩٠١٧٨٩٠")).toBe("69017890");
    expect(customerPhoneSearch("Amr")).toBeNull();
  });
});
