import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { PassThrough } from "node:stream";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { db, type AppError } from "../apps/api/src/lib/db";
import { D } from "../apps/api/src/utils/money";
import { reportPdf } from "../apps/api/src/utils/report-pdf";
import { handlePostSalesQuote } from "../apps/api/src/controllers/sales-quote.controller";

afterEach(() => vi.restoreAllMocks());
describe("round 5 medium regressions", () => {
  it("returns exact 44 preview with a blocking approval error while strict quotes still reject", async () => {
    const variantId = "11111111-1111-4111-8111-111111111111";
    const customerId = "22222222-2222-4222-8222-222222222222";
    const tx = {
      productVariant: {
        findMany: async () => [
          {
            id: variantId,
            price: D(120),
            active: true,
            product: { status: "ACTIVE", categoryId: "category" },
          },
        ],
      },
      promotion: { findMany: async () => [] },
      customer: { findUnique: async () => ({ discountPercent: D(5) }) },
      systemSetting: { findUnique: async () => null },
      loyaltyLot: { aggregate: async () => ({ _sum: { remaining: 0 } }) },
      loyaltyAccount: { findUnique: async () => null },
    };
    vi.spyOn(db, "$transaction").mockImplementation(async (fn: any) => fn(tx));
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = {
        id: customerId,
        name: "TEST",
        email: "test@example.test",
        roles: [],
        permissions: ["sales.create"],
        discountLimit: "10",
      };
      next();
    });
    app.post("/quote", handlePostSalesQuote);
    app.use(
      (
        error: AppError,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        res.status(error.status ?? 500).json({ code: error.code });
      },
    );
    const body = {
      shiftId: customerId,
      customerId,
      items: [{ variantId, quantity: 1 }],
      discount: "70",
      payments: [{ method: "CASH", amount: "44" }],
    };
    const strict = await request(app).post("/quote").send(body);
    expect(strict.status).toBe(403);
    expect(strict.body.code).toBe("DISCOUNT_LIMIT");
    const preview = await request(app)
      .post("/quote")
      .send({ ...body, previewOnly: true });
    expect(preview.status).toBe(200);
    expect(preview.body.data.total).toBe("44");
    expect(preview.body.data.discount).toBe("76");
    expect(preview.body.data.customerDiscount).toBe("6.00");
    expect(preview.body.data.authorizationError.code).toBe("DISCOUNT_LIMIT");
    expect(
      (
        await request(app)
          .post("/quote")
          .send({ ...body, previewOnly: "true" })
      ).status,
    ).toBe(403);
  });

  it("exports Arabic dates and signed amounts with readable LTR digits", async () => {
    const res = new PassThrough() as PassThrough & { set: () => void };
    res.set = () => {};
    const chunks: Buffer[] = [];
    res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    await reportPdf(
      res as any,
      "تقرير الاختبار",
      [
        { key: "date", label: "التاريخ والوقت" },
        { key: "amount", label: "المبلغ" },
        ...Array.from({ length: 7 }, (_, i) => ({
          key: `extra${i}`,
          label: "اختبار",
        })),
      ],
      [
        {
          date: new Date("2026-11-22T13:10:00Z").toLocaleString("ar-EG", {
            timeZone: "Africa/Cairo",
            hour: "numeric",
            minute: "2-digit",
            year: "numeric",
            month: "numeric",
            day: "numeric",
          }),
          amount: "-123.45",
        },
      ],
      "2026-11-22",
    );
    const loading = getDocument({
      data: new Uint8Array(Buffer.concat(chunks)),
      useSystemFonts: true,
    });
    const pdf = await loading.promise;
    const page = await pdf.getPage(1);
    const text = (await page.getTextContent()).items
      .map((item: any) => item.str)
      .join(" ");
    expect(text).toContain("2026-11-22");
    expect(text).toContain("PM");
    expect(text).toContain("3:10");
    expect(text).toContain("-123.45");
    expect(text).not.toMatch(/[٠-٩۰-۹]/);
    await loading.destroy();
  });
});
