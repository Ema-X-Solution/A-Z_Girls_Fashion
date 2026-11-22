import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as ui, type Browser } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
let browser: Browser, web: PreviewServer, url: string;
beforeAll(async () => {
  web = await preview({
    root: resolve("apps/web"),
    preview: { host: "127.0.0.1", port: 0 },
  });
  url = `http://127.0.0.1:${(web.httpServer.address() as { port: number }).port}`;
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL ?? "chromium",
    headless: true,
  });
  await mkdir("test-results/return-rounding", { recursive: true });
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => web?.httpServer.close(() => done()));
});
describe("return receipt cent reconciliation", () => {
  it.each([1440, 390])(
    "uses actual returned net for Savings at %spx",
    async (width) => {
      for (const taxMode of ["INCLUSIVE", "EXCLUSIVE"]) {
        const context = await browser.newContext({
          viewport: { width, height: 1000 },
        });
        try {
          const sale = {
            id: "test-sale",
            number: 33,
            receiptNumber: "INV-2026-00033",
            createdAt: "2026-11-22T16:00:00Z",
            user: { name: "TEST Cashier" },
            status: "PARTIALLY_RETURNED",
            subtotal: "361.50",
            discount: "46.15",
            total: "315.35",
            tax: "38.73",
            taxMode,
            taxRate: "14",
            change: "0",
            receiptSnapshot: {
              name: "TEST Store",
              receiptWidth: 80,
              cashierName: "TEST Cashier",
              returnPolicy: "TEST policy unchanged",
            },
            items: [
              {
                id: "test-item",
                name: "TEST Dress",
                sku: "TEST-001",
                quantity: 3,
                returned: 2,
                unitPrice: "120.50",
                discount: "46.15",
                total: "315.35",
                options: {},
              },
            ],
            payments: [{ method: "CASH", amount: "315.35" }],
          };
          await context.route("**/api/**", async (route) => {
            const path = new URL(route.request().url()).pathname;
            let data: unknown = [];
            if (path === "/api/auth/me")
              data = {
                id: "test-owner",
                name: "TEST Owner",
                roles: ["OWNER"],
                permissions: [
                  "sales.view_all",
                  "sales.view_own",
                  "sales.refund",
                  "dashboard.view",
                ],
                csrf: "test",
              };
            else if (path === "/api/sales") data = [sale];
            else if (path === "/api/shifts/current")
              data = { id: "test-shift" };
            else if (path === "/api/sales/test-sale/returns")
              data = {
                id: "test-return",
                createdAt: "2026-11-22T17:00:00Z",
                total: taxMode === "EXCLUSIVE" ? "119.83" : "105.11",
                refundAmount: taxMode === "EXCLUSIVE" ? "119.83" : "105.11",
                creditAmount: "0",
                method: "CASH",
                reason: "TEST partial return",
                items: [
                  {
                    id: "return-item",
                    saleItemId: "test-item",
                    quantity: 1,
                    amount: taxMode === "EXCLUSIVE" ? "119.83" : "105.11",
                    tax: "14.72",
                  },
                ],
              };
            else if (
              ["/api/store", "/api/branding", "/api/public/store"].includes(
                path,
              )
            )
              data = { name: "TEST Store" };
            await route.fulfill({ json: { data, pagination: { total: 1 } } });
          });
          const page = await context.newPage();
          page.setDefaultTimeout(5000);
          await page.goto(`${url}/sales`);
          await page
            .getByRole("button", { name: "إرجاع منتجات", exact: true })
            .first()
            .click();
          await page.locator('input[name="test-item"]').fill("1");
          await page
            .locator('textarea[name="reason"]')
            .fill("TEST partial return");
          await page
            .getByRole("button", { name: "اعتماد المرتجع", exact: true })
            .click();
          const receipt = page.locator(".receipt-preview");
          await ui(receipt).toBeVisible();
          await ui(receipt.locator(".receipt-item-saving")).toContainText(
            process.env.BEFORE_UI ? "-15.38" : "-15.39",
          );
          await ui(receipt.locator(".receipt-item-group")).toContainText(
            taxMode === "EXCLUSIVE" ? "119.83" : "105.11",
          );
          await page.screenshot({
            path: `test-results/return-rounding/${process.env.BEFORE_UI ? "before" : "after"}-${taxMode}-${width}.png`,
          });
          await page.emulateMedia({ media: "print" });
          await ui(
            page.locator("#az-receipt-print-root .receipt-item-saving"),
          ).toContainText(process.env.BEFORE_UI ? "-15.38" : "-15.39");
          expect(
            await page
              .locator("#az-receipt-print-root .receipt-item-saving")
              .innerText(),
          ).toContain("Savings");
        } finally {
          await context.close();
        }
      }
    },
  );
});
