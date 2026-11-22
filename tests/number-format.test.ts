import { describe, expect, it } from "vitest";
import {
  displayLocale,
  formatDate,
  formatMoney,
} from "../apps/web/src/i18n.js";

describe("English digits throughout the Arabic UI", () => {
  it("uses English digits for positive, negative and zero amounts without changing Arabic currency labels", () => {
    for (const amount of [0, 1234.56, -987.65]) {
      const result = formatMoney(amount);
      expect(result).not.toMatch(/[\u0660-\u0669\u06f0-\u06f9]/);
      expect(result).toMatch(/[0-9]/);
      expect(result).toContain("ج.م.");
    }
  });
  it("uses English digits in Cairo dates and direct date-only formatting", () => {
    const date = "2026-11-22T17:05:00Z";
    expect(formatDate(date)).not.toMatch(/[\u0660-\u0669\u06f0-\u06f9]/);
    expect(formatDate(date)).toContain("2026");
    expect(
      new Intl.DateTimeFormat(displayLocale).format(new Date(date)),
    ).toContain("2026");
    expect(formatDate(null)).toBe("—");
  });
});
