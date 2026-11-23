import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { db, type AppError } from "../apps/api/src/lib/db";
import { D } from "../apps/api/src/utils/money";
import { purchasesRouter } from "../apps/api/src/routes/purchases.routes";
const id = "11111111-1111-4111-8111-111111111111";
const order = {
  id,
  status: "PARTIAL",
  createdAt: new Date("2026-11-23T10:00:00Z"),
  supplier: { name: "مورد تجريبي للملابس" },
  location: { name: "المخزن الرئيسي" },
  items: [
    {
      variantId: "v1",
      quantity: 15,
      received: 10,
      unitCost: D("2675.00"),
      variant: {
        sku: "DRESS",
        options: { المقاس: "12", اللون: "أزرق" },
        product: { nameAr: "فستان بناتي صيفي قطن مطبوع بالورود" },
      },
    },
    {
      variantId: "v2",
      quantity: 10,
      received: 0,
      unitCost: D("997.00"),
      variant: {
        sku: "SET",
        options: { size: "8", color: "وردي" },
        product: { nameAr: "طقم بناتي قطعتين بأكمام طويلة" },
      },
    },
  ],
  receipts: [
    { createdAt: new Date("2026-11-23T10:30:00Z"), total: D("26750.00") },
  ],
};
const app = express();
app.use((req, _res, next) => {
  if (req.get("x-permission"))
    req.actor = {
      id,
      name: "TEST",
      email: "test@example.test",
      roles: [],
      discountLimit: "0",
      permissions: [req.get("x-permission")!],
    };
  next();
});
app.use("/api", purchasesRouter);
app.use((error: AppError, _req: Request, res: Response, _next: NextFunction) =>
  res.status(error.status ?? 400).json({ code: error.code }),
);
afterEach(() => vi.restoreAllMocks());
const pdfRequest = (permission = "purchases.preview", at = id) =>
  request(app)
    .get(`/api/purchases/${at}/pdf`)
    .set("x-permission", permission)
    .buffer(true)
    .parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(Buffer.from(c)));
      res.on("end", () => callback(null, Buffer.concat(chunks)));
    });
async function inspect(buffer: Buffer) {
  const loading = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  });
  const pdf = await loading.promise;
  try {
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++)
      text += (await (await pdf.getPage(i)).getTextContent()).items
        .map((i) => ("str" in i ? i.str : ""))
        .join(" ");
    return { text, pages: pdf.numPages };
  } finally {
    await loading.destroy();
  }
}
describe("purchase invoice PDF endpoint", () => {
  it.each(["purchases.preview", "purchases.view"])(
    "returns a real inline PDF with %s and exact totals",
    async (permission) => {
      const find = vi
        .spyOn(db.purchaseOrder, "findUnique")
        .mockResolvedValue(order as any);
      const res = await pdfRequest(permission);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("application/pdf");
      expect(res.headers["content-disposition"]).toBe(
        `inline; filename=purchase-${id}.pdf`,
      );
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id } }),
      );
      expect(res.body.subarray(0, 5).toString()).toBe("%PDF-");
      const { text, pages } = await inspect(res.body);
      expect(pages).toBe(1);
      expect(text).toContain("50,095.00 EGP");
      expect(text).toContain("40,125.00 EGP");
      expect(text).toContain("26,750.00 EGP");
      expect(text).toContain("23 Nov 2026");
      expect(text).not.toContain("ج.م");
      expect(text).toContain("المقاس");
      expect(text).toContain("اللون");
      const loading = getDocument({ data: new Uint8Array(res.body) });
      const document = await loading.promise;
      try {
        const content = await (await document.getPage(1)).getTextContent();
        const items = content.items.filter(
          (item): item is Extract<typeof item, { str: string }> =>
            "str" in item,
        );
        const size = items.find((item) => item.str === "12")!;
        const quantity = items.find((item) => item.str === "15")!;
        const color = items.find((item) => item.str.includes("أزرق"))!;
        const amount = items.find((item) => item.str === "40,125.00 EGP")!;
        expect(size).toBeDefined();
        expect(amount).toBeDefined();
        for (const cell of [quantity, color, amount]) {
          expect(cell.fontName).toBe(size.fontName);
          expect(cell.transform[5]).toBeCloseTo(size.transform[5], 2);
        }
      } finally {
        await loading.destroy();
      }
      mkdirSync("test-results/purchase-invoice", { recursive: true });
      writeFileSync(
        "test-results/purchase-invoice/purchase-example.pdf",
        res.body,
      );
    },
  );
  it("denies callers without either purchase-read permission before querying", async () => {
    const find = vi.spyOn(db.purchaseOrder, "findUnique");
    const res = await pdfRequest("purchases.create");
    expect(res.status).toBe(403);
    expect(find).not.toHaveBeenCalled();
  });
  it("rejects invalid IDs before querying", async () => {
    const find = vi.spyOn(db.purchaseOrder, "findUnique");
    expect((await pdfRequest("purchases.preview", "not-an-id")).status).toBe(
      400,
    );
    expect(find).not.toHaveBeenCalled();
  });
  it("returns 404 for a missing invoice", async () => {
    vi.spyOn(db.purchaseOrder, "findUnique").mockResolvedValue(null);
    expect((await pdfRequest()).status).toBe(404);
  });
  it("paginates 200 long-name lines and keeps the final total", async () => {
    const long = {
      ...order,
      receipts: [],
      items: Array.from({ length: 200 }, () => ({
        ...order.items[0],
        quantity: 1,
        unitCost: D("0.10"),
        variant: {
          ...order.items[0].variant,
          product: { nameAr: "فستان بناتي طويل ".repeat(8) },
        },
      })),
    };
    vi.spyOn(db.purchaseOrder, "findUnique").mockResolvedValue(long as any);
    const res = await pdfRequest();
    expect(res.status).toBe(200);
    const { text, pages } = await inspect(res.body);
    expect(pages).toBeGreaterThan(1);
    expect(text).toContain("20.00 EGP");
  });
});
