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
it.each([1440, 390])("supplier filter and label fallback in RTL at %spx", async (width) => {
  const page = await browser.newPage({ viewport: { width, height: 1100 } });
  const supplier = { id: "11111111-1111-4111-8111-111111111111", name: "المورد الأول", code: "SUP-0001" };
  const product = (id: string, nameAr: string, supplierCode: string | null, options = {}) => ({ id, nameAr, supplierCode, variants: [{ id: `v${id}`, sku: `VAR-${id}`, barcode: `20123456789${id}`, price: "100.00", active: true, options, balances: [{ quantity: 1 }] }] });
  const products = [product("1", "فستان بناتي", supplier.code), product("2", "بلوزة بدون مورد", null), product("3", "فستان بمقاس ولون", supplier.code, { المقاس: "S", اللون: "Red" })];
  let filtered = false;
  await page.route("**/api/**", async (route) => {
    const req = new URL(route.request().url()), path = req.pathname;
    let data: any = [];
    if (path === "/api/auth/me") data = { id: "owner", name: "مدير تجريبي", roles: ["OWNER"], permissions: ["products.view", "products.create", "products.update", "barcodes.print"], csrf: "test" };
    else if (path === "/api/branding" || path === "/api/public/store") data = { name: "A&Z Girls Fashion" };
    else if (path === "/api/options/suppliers") { await route.fulfill({ json: { data: [supplier], hasMore: false, selected: supplier } }); return; }
    else if (path === "/api/products") { filtered = !!req.searchParams.get("supplierId"); await route.fulfill({ json: { data: filtered ? [products[0], products[2]] : products, total: filtered ? 2 : 3 } }); return; }
    else if (path === "/api/barcodes/print-labels") data = { storeName: "A&Z Girls Fashion", items: route.request().postDataJSON().items.map((v: any) => { const p = products.find((p) => p.variants[0].id === v.variantId)!; return { ...p.variants[0], variantId: v.variantId, name: p.nameAr, supplierCode: p.supplierCode, quantity: v.quantity }; }) };
    await route.fulfill({ json: { data } });
  });
  try {
    await page.goto(`${url}/products/barcodes`);
    const all = page.getByRole("checkbox", { name: "اختيار كل الظاهر في الصفحة", exact: true });
    await all.check(); await page.getByRole("button", { name: "معاينة الملصقات", exact: true }).click();
    const labels = page.locator(".barcode-preview .label-options");
    await ui(labels.locator(".label-supplier")).toHaveText(["SUP-0001", "", "SUP-0001"]);
    await ui(labels.locator(".label-size")).toHaveText(["", "", "S"]);
    await ui(labels.locator(".label-color")).toHaveText(["", "", "Red"]);
    const positions = await labels.last().evaluate((el) => [...el.children].map((child) => child.getBoundingClientRect().x));
    expect(positions[0]).toBeLessThan(positions[1]);
    expect(positions[1]).toBeLessThan(positions[2]);
    await ui(page.locator(".barcode-preview .label-number").first()).toHaveText("201234567891");
    await pickSmartOption(page, "تصفية حسب المورد الأساسي", supplier.name);
    await ui(page.getByRole("checkbox", { name: "اختيار VAR-2", exact: true })).toHaveCount(0);
    expect(filtered).toBe(true); await ui(all).not.toBeChecked();
    await all.check(); await page.getByRole("button", { name: "معاينة الملصقات", exact: true }).click();
    await ui(page.locator(".barcode-preview .label-supplier")).toHaveText(["SUP-0001", "SUP-0001"]);
    await page.screenshot({ path: `test-results/supplier-feature/barcode-filter-${width}.png`, fullPage: true });
    await page.locator(".barcode-preview-panel").screenshot({ path: `test-results/supplier-feature/labels-${width}.png` });
    await page.getByRole("button", { name: "مسح تصفية حسب المورد الأساسي", exact: true }).click();
    await ui(page.getByRole("checkbox", { name: "اختيار VAR-2", exact: true })).toBeVisible();
  } finally { await page.close(); }
});
