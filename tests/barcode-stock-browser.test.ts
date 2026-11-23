import { beforeAll, afterAll, it, expect } from "vitest";
import { chromium, expect as ui, type Browser } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
let browser: Browser, web: PreviewServer, url: string;
beforeAll(async () => {
  web = await preview({ root: resolve("apps/web"), preview: { host: "127.0.0.1", port: 0 } });
  url = `http://127.0.0.1:${(web.httpServer.address() as { port: number }).port}`;
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE ?? "/usr/bin/google-chrome", headless: true });
  await mkdir("test-results/barcode-stock", { recursive: true });
});
afterAll(async () => { await browser?.close(); await new Promise<void>((done) => web?.httpServer.close(() => done())); });
it("defaults to net stock, skips zero/negative quantities, keeps edits and enforces exact batch limits", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const variants = [
    { id: "1", sku: "VAR-1", balances: [{ quantity: 12 }, { quantity: 8 }] },
    { id: "2", sku: "VAR-2", balances: [{ quantity: 0 }] },
    { id: "3", sku: "VAR-3", balances: [{ quantity: -5 }, { quantity: 2 }] },
    { id: "4", sku: "VAR-4", balances: [{ quantity: 600 }] },
  ].map((v) => ({ ...v, barcode: `20123456789${v.id}`, price: "100.00", active: true, options: {} }));
  let printed: any[] = [];
  let many = false;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path === "/api/auth/me") data = { id: "owner", name: "مدير تجريبي", roles: ["OWNER"], permissions: ["products.view", "barcodes.print"], csrf: "test" };
    else if (path === "/api/branding" || path === "/api/public/store") data = { name: "A&Z Girls Fashion" };
    else if (path === "/api/products") { await route.fulfill({ json: { data: [{ id: "p1", nameAr: "فستان بناتي", variants: many ? Array.from({ length: 101 }, (_, i) => ({ ...variants[0], id: `many-${i}`, sku: `MANY-${i}`, balances: [{ quantity: 1 }] })) : variants }], total: 1 } }); return; }
    else if (path === "/api/barcodes/receipts/receipt/items") data = { products: [{ id: "p1", nameAr: "فستان بناتي", variants: [variants[0]] }], quantities: { "1": 3 } };
    else if (path === "/api/barcodes/print-labels") { printed = route.request().postDataJSON().items; data = { storeName: "A&Z Girls Fashion", items: printed.map((x: any) => ({ ...variants.find((v) => v.id === x.variantId), variantId: x.variantId, name: "فستان بناتي", quantity: x.quantity })) }; }
    await route.fulfill({ json: { data } });
  });
  try {
    await page.goto(`${url}/products/barcodes`);
    const pick = (i: number) => page.getByRole("checkbox", { name: `اختيار VAR-${i}`, exact: true });
    const qty = (i: number) => page.getByRole("spinbutton", { name: `عدد ملصقات VAR-${i}`, exact: true });
    const prepare = page.getByRole("button", { name: "معاينة الملصقات", exact: true });
    await pick(1).check(); await ui(qty(1)).toHaveValue("20");
    await pick(2).check(); await ui(qty(2)).toHaveValue("0");
    await pick(3).check(); await ui(qty(3)).toHaveValue("0");
    await prepare.click(); await ui(page.locator(".barcode-preview .retail-label")).toHaveCount(20);
    expect(printed).toEqual([{ variantId: "1", quantity: 20 }]);
    await ui(page.locator("#az-label-print-root .retail-label")).toHaveCount(20);
    await page.locator(".barcode-picker").screenshot({ path: "test-results/barcode-stock/stock-quantities.png" });
    await page.locator(".barcode-preview-panel").screenshot({ path: "test-results/barcode-stock/stock-preview.png" });
    await qty(1).fill("7");
    await page.getByRole("checkbox", { name: "اختيار كل الظاهر في الصفحة", exact: true }).check();
    await ui(qty(1)).toHaveValue("7"); await ui(qty(4)).toHaveValue("600");
    await ui(prepare).toBeDisabled(); await ui(page.getByRole("alert")).toContainText("607");
    await pick(4).uncheck(); await qty(2).fill("2"); await prepare.click();
    await ui(page.locator(".barcode-preview .retail-label")).toHaveCount(9);
    expect(printed).toEqual([{ variantId: "1", quantity: 7 }, { variantId: "2", quantity: 2 }]);
    await page.goto(`${url}/products/barcodes?receiptId=receipt`);
    await ui(qty(1)).toHaveValue("3");
    await page.getByRole("checkbox", { name: "اختيار كل الظاهر في الصفحة", exact: true }).uncheck();
    await page.getByRole("checkbox", { name: "اختيار كل الظاهر في الصفحة", exact: true }).check();
    await ui(qty(1)).toHaveValue("3"); await prepare.click();
    await ui(page.locator(".barcode-preview .retail-label")).toHaveCount(3);
    many = true;
    await page.goto(`${url}/products/barcodes`);
    await page.getByRole("checkbox", { name: "اختيار كل الظاهر في الصفحة", exact: true }).check();
    await ui(prepare).toBeDisabled();
    await ui(page.getByRole("alert")).toContainText("101");
  } finally { await page.close(); }
});
