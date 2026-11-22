import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as ui, type Browser } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
let browser: Browser;
let web: PreviewServer;
let url: string;

beforeAll(async () => {
  web = await preview({
    root: resolve("apps/web"),
    preview: { host: "127.0.0.1", port: 0 },
  });
  url = `http://127.0.0.1:${(web.httpServer.address() as { port: number }).port}`;
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL ?? "msedge",
    headless: true,
  });
  await mkdir("test-results/dashboard", { recursive: true });
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => web?.httpServer.close(() => done()));
});

describe("dashboard date filters in the built Arabic UI", () => {
  it.each([1440, 390])(
    "uses the month default, applies dates and rejects invalid ranges at %spx",
    async (width) => {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
      });
      try {
        const page = await context.newPage();
        const queries: URLSearchParams[] = [];
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.clock.setFixedTime(new Date("2026-11-22T17:00:00Z"));
        await context.route("**/api/**", async (route) => {
          const request = new URL(route.request().url());
          let data: unknown = [];
          if (request.pathname === "/api/auth/me")
            data = {
              id: "11111111-1111-4111-8111-111111111111",
              name: "TEST Owner",
              email: "owner@example.test",
              roles: ["OWNER"],
              permissions: ["dashboard.view", "pos.access"],
              csrf: "fixture-csrf",
              discountLimit: "0",
            };
          else if (
            ["/api/store", "/api/public/store", "/api/branding"].includes(
              request.pathname,
            )
          )
            data = {
              name: "A&Z Girls Fashion",
              taxRate: "0",
              taxMode: "EXCLUSIVE",
            };
          else if (request.pathname === "/api/reports/dashboard") {
            queries.push(request.searchParams);
            data = {
              totalSalesWithTax:
                request.searchParams.get("from") === "2026-10-31T22:00:00.000Z"
                  ? "1234.56"
                  : "432.10",
              orders: 2,
              returns: "0",
              netSales: "1000",
              discounts: "0",
              tax: "0",
              daily: [],
              cashiers: [
                {
                  id: "cashier-1",
                  name: "TEST Cashier",
                  sellerCode: "EMP-001",
                  invoices: 2,
                  salesWithTax: "1234.56",
                  returnsWithTax: "100",
                  grossSales: "1134.56",
                },
                {
                  id: "cashier-2",
                  name: "TEST Cashier",
                  sellerCode: "EMP-002",
                  invoices: 1,
                  salesWithTax: "800",
                  returnsWithTax: "50",
                  grossSales: "750",
                },
              ],
            };
          }
          await route.fulfill({ json: { data } });
        });
        await page.goto(`${url}/dashboard`);
        await ui(page.getByLabel("من تاريخ", { exact: true })).toHaveValue(
          "2026-11-01",
        );
        await ui(page.getByLabel("إلى تاريخ", { exact: true })).toHaveValue(
          "2026-11-22",
        );
        await ui(page.locator(".stat-card.featured")).toContainText("1,234.56");
        expect(queries.at(-1)?.get("from")).toBe("2026-10-31T22:00:00.000Z");
        expect(queries.at(-1)?.get("to")).toBe("2026-11-22T21:59:59.999Z");
        await ui(
          page.getByRole("combobox", { name: "الفترة", exact: true }),
        ).toHaveCount(0);
        const geometry = await page.evaluate(() => {
          const header = document.querySelector(".page-head")!;
          return {
            containsDates: !!header.querySelector("input[type=date]"),
            containsSale: [...header.querySelectorAll("a")].some(
              (a) => a.getAttribute("href") === "/pos",
            ),
            width: document.documentElement.scrollWidth,
          };
        });
        expect(geometry.containsDates && geometry.containsSale).toBe(true);
        expect(geometry.width).toBeLessThanOrEqual(width);
        const cashierGeometry = await page
          .locator(".cashier-performance")
          .evaluate((panel) => {
            const card = panel.getBoundingClientRect();
            const row = panel
              .querySelector(".cashier-performance-row")!
              .getBoundingClientRect();
            return {
              card: card.width,
              row: row.width,
              left: row.left - card.left,
              right: card.right - row.right,
            };
          });
        expect(cashierGeometry.row).toBeGreaterThanOrEqual(
          cashierGeometry.card - (width > 760 ? 52 : 34),
        );
        expect(
          Math.abs(cashierGeometry.left - cashierGeometry.right),
        ).toBeLessThan(2);
        await ui(page.locator(".cashier-performance-row")).toHaveCount(2);
        await ui(page.locator(".cashier-performance")).toContainText("EMP-001");
        await ui(page.locator(".cashier-performance")).toContainText("EMP-002");
        await page
          .locator(".cashier-performance")
          .screenshot({ path: `test-results/dashboard/cashiers-${width}.png` });
        await page.screenshot({
          path: `test-results/dashboard/default-${width}.png`,
          fullPage: true,
        });
        const originalCount = queries.length;
        await page.getByLabel("من تاريخ", { exact: true }).fill("2026-11-10");
        await page.getByLabel("إلى تاريخ", { exact: true }).fill("2026-11-20");
        expect(queries.length).toBe(originalCount);
        await ui(page.locator(".stat-card.featured")).toContainText("1,234.56");
        await page.getByRole("button", { name: "تطبيق", exact: true }).click();
        await ui(page.locator(".stat-card.featured")).toContainText("432.10");
        expect(queries.at(-1)?.get("from")).toBe("2026-11-09T22:00:00.000Z");
        expect(queries.at(-1)?.get("to")).toBe("2026-11-20T21:59:59.999Z");
        const appliedCount = queries.length;
        await page.getByLabel("من تاريخ", { exact: true }).fill("2026-11-21");
        await ui(page.getByRole("alert")).toContainText(
          "النهاية لا تسبق البداية",
        );
        await ui(
          page.getByRole("button", { name: "تطبيق", exact: true }),
        ).toBeDisabled();
        expect(queries.length).toBe(appliedCount);
        await page.getByLabel("من تاريخ", { exact: true }).fill("");
        await ui(
          page.getByRole("button", { name: "تطبيق", exact: true }),
        ).toBeDisabled();
        expect(queries.length).toBe(appliedCount);
        await page.screenshot({
          path: `test-results/dashboard/invalid-${width}.png`,
          fullPage: true,
        });
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    },
  );
});
