import { describe, expect, it } from "vitest";
import { variantOption } from "../packages/shared/src/variant-options";

describe("variant option compatibility", () => {
  it("reads the Arabic keys written by the product form", () => {
    expect(variantOption({ المقاس: "12", اللون: "أزرق" }, "size")).toBe("12");
    expect(variantOption({ المقاس: "12", اللون: "أزرق" }, "color")).toBe(
      "أزرق",
    );
  });
  it("preserves English-key variants and numeric sizes", () => {
    expect(variantOption({ size: 8, color: "وردي" }, "size")).toBe("8");
    expect(variantOption({ size: 8, color: "وردي" }, "color")).toBe("وردي");
  });
  it("falls back from blank English values to Arabic values", () => {
    expect(variantOption({ size: " ", المقاس: "12" }, "size")).toBe("12");
    expect(variantOption({ color: null, اللون: "أزرق" }, "color")).toBe("أزرق");
  });
  it("keeps existing English-key precedence when both are populated", () => {
    expect(variantOption({ size: "8", المقاس: "12" }, "size")).toBe("8");
  });
  it.each([null, undefined, {}, [], "12", { size: {} }, { size: "" }])(
    "does not invent values for missing or invalid options: %j",
    (options) => {
      expect(variantOption(options, "size")).toBe("");
      expect(variantOption(options, "color")).toBe("");
    },
  );
});
