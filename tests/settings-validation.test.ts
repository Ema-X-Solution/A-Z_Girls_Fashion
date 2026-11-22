import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { handlePatchSettingsStore } from "../apps/api/src/controllers/settings.controller";
import {
  loyaltySettingsSchema,
  loyaltyQuote,
} from "../apps/api/src/services/loyalty";
import { D } from "../apps/api/src/utils/money";
import { ApiError } from "../apps/web/src/api";
import { readableError } from "../apps/web/src/app/notifications";
afterEach(() => vi.restoreAllMocks());
const store = {
  name: "TEST store",
  currency: "EGP",
  timezone: "Africa/Cairo",
  address: "",
  phone: "",
  taxRate: "14",
  returnDays: 14,
  receiptFooter: "TEST unchanged",
  receiptWidth: 80,
  invoicePrefix: "INV",
  returnPolicy: "TEST unchanged policy",
};
describe("settings safeguards", () => {
  it.each([
    [{ name: "<script>alert(1)</script>" }, "name", "نصًا فقط"],
    [{ returnDays: 366 }, "returnDays", "365"],
    [{ returnDays: 1.5 }, "returnDays", "عددًا صحيحًا"],
    [{ invoicePrefix: "غير صحيح" }, "invoicePrefix", "12"],
    [{ receiptFooter: "x".repeat(1001) }, "receiptFooter", "1000"],
    [{ returnPolicy: "x".repeat(5001) }, "returnPolicy", "5000"],
    [{ taxRate: "100.01" }, "taxRate", "100"],
  ] as const)(
    "explains invalid field %# before any write",
    async (patch, field, part) => {
      const error = await new Promise<any>((resolve) => {
        handlePatchSettingsStore(
          { body: { ...store, ...patch } } as Request,
          {} as Response,
          resolve,
        );
      });
      expect(error.flatten().fieldErrors[field].join(" ")).toContain(part);
    },
  );
  it("keeps valid loyalty decimals exact and enforces server ranges", () => {
    expect(
      loyaltySettingsSchema.parse({ spendPerPoint: "3.33", pointValue: "0.50" })
        .spendPerPoint,
    ).toBe("3.33");
    expect(
      loyaltySettingsSchema.safeParse({ spendPerPoint: "0" }).success,
    ).toBe(false);
    expect(
      loyaltySettingsSchema.safeParse({ pointValue: "100.01" }).success,
    ).toBe(false);
    expect(loyaltySettingsSchema.safeParse({ expiryDays: 1.5 }).success).toBe(
      false,
    );
  });
  it("returns an Arabic reason for insufficient points", async () => {
    const tx = {
      systemSetting: { findUnique: async () => ({ value: { enabled: true } }) },
      loyaltyLot: { aggregate: async () => ({ _sum: { remaining: 2 } }) },
      loyaltyAccount: { findUnique: async () => null },
    };
    await expect(
      loyaltyQuote(tx as never, "test", 3, D(100)),
    ).rejects.toMatchObject({
      code: "LOYALTY_BALANCE",
      message: "رصيد نقاط الولاء المتاح لا يكفي للاستبدال.",
    });
  });
  it("names settings fields and ranges in API failures", () => {
    for (const field of [
      "returnDays",
      "invoicePrefix",
      "spendPerPoint",
      "pointValue",
    ]) {
      const message = readableError(
        new ApiError(400, "VALIDATION", "Invalid request", {
          [field]: ["Invalid input"],
        }),
      );
      expect(message).not.toContain("قيمة الحقل");
      expect(message).not.toContain("Invalid");
    }
  });
});
