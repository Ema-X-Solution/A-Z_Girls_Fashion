import { afterAll, beforeAll, describe, it, expect } from "vitest";
import {
  chromium,
  expect as ui,
  type Browser,
  type Locator,
} from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
let browser: Browser, web: PreviewServer, url: string;
const before = !!process.env.BEFORE_UI;
const name = "فستان بناتي صيفي قطن مطبوع بالورود مقاس 3077";
const variant = {
  id: "11111111-1111-4111-8111-111111111111",
  sku: "DRESS-S",
  barcode: "205372921865",
  price: "895.00",
  active: true,
  options: { color: "C", size: "S" },
  balances: [{ quantity: 3 }],
};
beforeAll(async () => {
  web = await preview({
    root: resolve("apps/web"),
    preview: { host: "127.0.0.1", port: 0 },
  });
  url = `http://127.0.0.1:${(web.httpServer.address() as { port: number }).port}`;
  browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    channel: process.env.BROWSER_EXECUTABLE
      ? undefined
      : (process.env.BROWSER_CHANNEL ?? "chromium"),
    headless: true,
  });
  await mkdir("test-results/label-40x25", { recursive: true });
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => web?.httpServer.close(() => done()));
});
async function checkLayout(label: Locator, price: boolean) {
  const boxes = await label.evaluate((el) => {
    const bounds = el.getBoundingClientRect();
    return {
      width: bounds.width,
      height: bounds.height,
      rows: Array.from(el.children).map((child) => {
        const r = child.getBoundingClientRect();
        return {
          top: r.top - bounds.top,
          bottom: r.bottom - bounds.top,
          left: r.left - bounds.left,
          right: r.right - bounds.left,
          height: r.height,
          scrollHeight: child.scrollHeight,
          clientHeight: child.clientHeight,
          cls: child.getAttribute("class"),
        };
      }),
    };
  });
  expect(boxes.width).toBeCloseTo((40 * 96) / 25.4, 0);
  expect(boxes.height).toBeCloseTo((25 * 96) / 25.4, 0);
  expect(boxes.rows).toHaveLength(price ? 5 : 4);
  for (const [index, row] of boxes.rows.entries()) {
    expect(row.top).toBeGreaterThanOrEqual(0);
    expect(row.bottom).toBeLessThanOrEqual(boxes.height + 0.2);
    expect(row.left).toBeGreaterThanOrEqual(0);
    expect(row.right).toBeLessThanOrEqual(boxes.width + 0.2);
    expect(row.height).toBeGreaterThan(7);
    if (index)
      expect(row.top + 0.2).toBeGreaterThanOrEqual(
        boxes.rows[index - 1].bottom,
      );
  }
  await ui(label.locator(".label-name")).toHaveText(name);
  expect(boxes.rows[0].scrollHeight).toBeLessThanOrEqual(
    boxes.rows[0].clientHeight + 1,
  );
}
describe("40x25 barcode label", () => {
  it.each([390, 1440])("fits preview and print at %spx", async (width) => {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      deviceScaleFactor: 2,
    });
    await context.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let data: unknown = [];
      if (path === "/api/auth/me")
        data = {
          id: "owner",
          name: "مدير تجريبي",
          roles: ["OWNER"],
          permissions: ["products.view", "barcodes.print"],
          csrf: "test",
        };
      else if (path === "/api/branding" || path === "/api/public/store")
        data = { name: "A&Z Girls Fashion" };
      else if (path === "/api/products") {
        await route.fulfill({
          json: {
            data: [{ id: "product", nameAr: name, variants: [variant] }],
            total: 1,
          },
        });
        return;
      } else if (path === "/api/barcodes/print-labels")
        data = {
          storeName: "A&Z Girls Fashion",
          items: [{ variantId: variant.id, name, ...variant, quantity: 3 }],
        };
      await route.fulfill({ json: { data } });
    });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      await page.goto(`${url}/products/barcodes`);
      const size = page.getByLabel("مقاس الملصق", { exact: true });
      if (before) {
        await size.selectOption("custom");
        await page.getByLabel("العرض (مم)").fill("40");
        await page.getByLabel("الارتفاع (مم)").fill("25");
      } else await ui(size).toHaveValue("40x25");
      await page
        .locator(".barcode-settings")
        .screenshot({
          path: `test-results/label-40x25/${before ? "before" : "after"}-settings-${width}.png`,
        });
      await page
        .getByRole("checkbox", { name: "اختيار DRESS-S", exact: true })
        .check();
      await page
        .getByRole("button", { name: "معاينة الملصقات", exact: true })
        .click();
      const label = page.locator(".barcode-preview .retail-label").first();
      await ui(label).toBeVisible();
      for (const price of [true, false]) {
        await page
          .getByRole("checkbox", { name: "إظهار سعر البيع", exact: true })
          .setChecked(price);
        await page
          .locator(".barcode-preview-panel")
          .screenshot({
            path: `test-results/label-40x25/${before ? "before" : "after"}-${width}-${price ? "price" : "no-price"}.png`,
          });
        if (before) continue;
        await checkLayout(label, price);
        for (const paper of ["thermal", "a4"]) {
          await page
            .getByLabel("نوع الورق", { exact: true })
            .selectOption(paper);
          await page.emulateMedia({ media: "print" });
          const printed = page
            .locator("#az-label-print-root .retail-label")
            .first();
          await checkLayout(printed, price);
          if (width === 1440) {
            await printed.screenshot({
              path: `test-results/label-40x25/print-${paper}-${price ? "price" : "no-price"}.png`,
            });
            const pdf = await page.pdf({
              path: `test-results/label-40x25/${paper}-${price ? "price" : "no-price"}.pdf`,
              preferCSSPageSize: true,
              printBackground: true,
            });
            expect(
              (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length,
            ).toBe(paper === "thermal" ? 3 : 1);
          }
          await page.emulateMedia({ media: "screen" });
        }
      }
      for (const preset of ["40x30", "50x30", "60x40"]) {
        await size.selectOption(preset);
        await label.screenshot({
          path: `test-results/label-40x25/${before ? "before" : "after"}-${preset}-${width}.png`,
        });
      }
      if (!before) {
        await size.selectOption("custom");
        await page.getByLabel("العرض (مم)").fill("40");
        await page.getByLabel("الارتفاع (مم)").fill("25");
        await checkLayout(label, false);
        for (const preset of ["40x30", "50x30", "60x40"]) {
          await size.selectOption(preset);
          await ui(label).not.toHaveClass(/retail-label-40x25/);
        }
        await page.reload();
        await ui(page.getByLabel("مقاس الملصق", { exact: true })).toHaveValue(
          "40x25",
        );
      }
    } finally {
      await context.close();
    }
  });
});
