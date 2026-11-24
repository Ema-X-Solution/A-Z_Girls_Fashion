import { beforeAll, afterAll, it, expect } from "vitest";
import { chromium, expect as ui, type Browser } from "@playwright/test";
import { pickSmartOption } from "./smart-select";
import { preview, type PreviewServer } from "vite";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
let browser: Browser, web: PreviewServer, url: string;
beforeAll(async () => {
  web = await preview({ root: resolve("apps/web"), preview: { host: "127.0.0.1", port: 0 } });
  url = `http://127.0.0.1:${(web.httpServer.address() as { port: number }).port}`;
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE ?? "/usr/bin/google-chrome", headless: true });
  await mkdir("test-results/supplier-feature", { recursive: true });
});
afterAll(async () => { await browser?.close(); await new Promise<void>((done) => web?.httpServer.close(() => done())); });
it.each([1440, 390])("product create/edit primary supplier at %spx", async (width) => {
  const page = await browser.newPage({ viewport: { width, height: 1100 } });
  page.setDefaultTimeout(4000);
  const supplier = { id: "11111111-1111-4111-8111-111111111111", name: "المورد الأول", code: "SUP-0001" };
  const category = { id: "22222222-2222-4222-8222-222222222222", name: "فساتين" };
  const product = { id: "p1", nameAr: "فستان بناتي", sku: "PRD-1", primarySupplierId: supplier.id, description: "", returnRule: "STANDARD", status: "ACTIVE", variants: [{ id: "v1", sku: "VAR-1", barcode: "201234567891", price: "100", options: {}, balances: [], minStock: 2 }] };
  let body: any;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname; let data: any = [];
    if (path === "/api/auth/me") data = { id: "owner", name: "مدير تجريبي", roles: ["OWNER"], permissions: ["products.view", "products.create", "products.update"], csrf: "test" };
    else if (path === "/api/branding" || path === "/api/public/store") data = { name: "A&Z Girls Fashion" };
    else if (path === "/api/options/suppliers" || path === "/api/options/categories" || path === "/api/options/brands") { const row = path.endsWith("suppliers") ? supplier : category; await route.fulfill({ json: { data: [row], hasMore: false, selected: row } }); return; }
    else if (path === "/api/products") { if (route.request().method() === "POST") { body = route.request().postDataJSON(); data = { ...product, ...body }; } else { await route.fulfill({ json: { data: [product], total: 1 } }); return; } }
    else if (path === "/api/products/p1") { body = route.request().postDataJSON(); data = { ...product, ...body }; }
    await route.fulfill({ json: { data } });
  });
  try {
    await page.goto(`${url}/products`); await page.getByRole("button", { name: "إضافة منتج", exact: true }).click();
    await pickSmartOption(page, "المورد الأساسي", supplier.name);
    await page.screenshot({ path: `test-results/supplier-feature/product-create-${width}.png`, fullPage: true });
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[name="nameAr"]').fill("منتج جديد");
    await dialog.locator('[name="categoryId"]').selectOption(category.id);
    await dialog.locator('button.form-submit').click();
    await ui(dialog).toHaveCount(0); expect(body.primarySupplierId).toBe(supplier.id);
    await page.getByRole("button", { name: "التفاصيل", exact: true }).click();
    await ui(page.getByLabel("المورد الأساسي", { exact: true })).toHaveValue(supplier.name);
    await page.getByRole("button", { name: "مسح المورد الأساسي", exact: true }).click();
    await page.getByRole("dialog").locator('button.form-submit').click();
    await ui(page.getByRole("dialog")).toHaveCount(0); expect(body.primarySupplierId).toBe("");
  } finally { await page.close(); }
});
