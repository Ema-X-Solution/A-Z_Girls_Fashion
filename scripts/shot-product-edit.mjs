/* global URL */
import { chromium } from "@playwright/test";
import { preview } from "vite";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";

// usage: node scripts/shot-product-edit.mjs <prefix> <width> <height>
const [prefix = "after", width = 1440, height = 1000] = process.argv.slice(2);
const web = await preview({ root: resolve("apps/web"), preview: { host: "127.0.0.1", port: 0 } });
const url = `http://127.0.0.1:${web.httpServer.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE ?? "/usr/bin/google-chrome", headless: true });
await mkdir("test-results/product-edit", { recursive: true });

const product = {
  id: "p1", nameAr: "فستان بناتي شيفون", sku: "PRD-1", primarySupplierId: "s1",
  description: "فستان بناتي شيفون بجودة ممتازة", returnRule: "STANDARD", status: "ACTIVE", imageUrl: null,
  variants: [
    { id: "v1", sku: "VAR-1", barcode: "201234567891", price: "350", options: { "المقاس": "4 سنوات", "اللون": "وردي" }, balances: [{ quantity: 5, location: { name: "المحل" } }], minStock: 2 },
    { id: "v2", sku: "VAR-2", barcode: "201234567892", price: "380", options: { "المقاس": "6 سنوات", "اللون": "أبيض" }, balances: [{ quantity: 3, location: { name: "المحل" } }], minStock: 3 },
  ],
};
const supplier = { id: "s1", name: "مكتب العالمية", code: "SUP-0001" };

const page = await browser.newPage({ viewport: { width: +width, height: +height } });
await page.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  let data = [];
  if (path === "/api/auth/me") data = { id: "owner", name: "مدير", roles: ["OWNER"], permissions: ["products.view", "products.create", "products.update", "products.change_price", "products.archive"], csrf: "test" };
  else if (path === "/api/branding" || path === "/api/public/store") data = { name: "A&Z Girls Fashion" };
  else if (path.startsWith("/api/options/")) { await route.fulfill({ json: { data: path.endsWith("suppliers") ? [supplier] : [], hasMore: false, selected: path.endsWith("suppliers") ? supplier : undefined } }); return; }
  else if (path === "/api/products") { await route.fulfill({ json: { data: [product], total: 1 } }); return; }
  else if (path === "/api/products/p1") data = product;
  await route.fulfill({ json: { data } });
});
await page.goto(`${url}/products`);
await page.getByRole("button", { name: "التفاصيل", exact: true }).click();
const dialog = page.getByRole("dialog");
await dialog.locator("button.form-submit").first().waitFor();
await page.waitForTimeout(600);
await page.screenshot({ path: `test-results/product-edit/${prefix}-top-${width}.png` });
await dialog.locator("button.form-submit").last().scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.screenshot({ path: `test-results/product-edit/${prefix}-save-${width}.png` });
await browser.close();
await new Promise((done) => web.httpServer.close(() => done()));
console.log("done", prefix, width);
