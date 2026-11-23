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
  await mkdir("test-results/barcode-select-all", { recursive: true });
});
afterAll(async () => { await browser?.close(); await new Promise<void>((done) => web?.httpServer.close(() => done())); });
it("selects only visible active variants, retains quantities/off-page choices and clears stale preview", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const variant = (i: number, active = true) => ({ id: String(i), sku: `VAR-${i}`, barcode: `20123456789${i}`, price: "100.00", active, options: {}, balances: [{ quantity: 10 }] });
  let printed: any[] = [];
  await page.route("**/api/**", async (route) => {
    const req = new URL(route.request().url()), path = req.pathname;
    let data: unknown = [];
    if (path === "/api/auth/me") data = { id: "owner", name: "مدير تجريبي", roles: ["OWNER"], permissions: ["products.view", "barcodes.print"], csrf: "test" };
    else if (path === "/api/branding" || path === "/api/public/store") data = { name: "A&Z Girls Fashion" };
    else if (path === "/api/products") { const n = Number(req.searchParams.get("page") ?? 1); const q = req.searchParams.get("q"); await route.fulfill({ json: { data: q === "missing" ? [] : [{ id: `p${n}`, nameAr: n === 1 ? "فستان بناتي" : "بلوزة بناتي", variants: n === 1 ? [variant(1), variant(2), variant(9, false)] : [variant(3)] }], total: q === "missing" ? 0 : 26 } }); return; }
    else if (path === "/api/barcodes/print-labels") { printed = route.request().postDataJSON().items; data = { storeName: "A&Z Girls Fashion", items: printed.map((x: any) => ({ ...variant(Number(x.variantId)), variantId: x.variantId, name: "فستان بناتي", quantity: x.quantity })) }; }
    await route.fulfill({ json: { data } });
  });
  try {
    await page.goto(`${url}/products/barcodes`);
    const all = page.getByRole("checkbox", { name: "اختيار كل الظاهر في الصفحة", exact: true });
    const one = page.getByRole("checkbox", { name: "اختيار VAR-1", exact: true });
    await ui(all).not.toBeChecked();
    await one.check(); await ui(all).toBeChecked({ indeterminate: true });
    await page.getByRole("spinbutton", { name: "عدد ملصقات VAR-1", exact: true }).fill("7");
    await all.check(); await ui(all).toBeChecked();
    await ui(page.getByRole("spinbutton", { name: "عدد ملصقات VAR-1", exact: true })).toHaveValue("7");
    expect(await page.getByRole("checkbox", { name: "اختيار VAR-9", exact: true }).count()).toBe(0);
    await page.screenshot({ path: "test-results/barcode-select-all/page-selected.png", fullPage: true });
    await page.getByRole("button", { name: "معاينة الملصقات", exact: true }).click();
    await ui(page.locator(".barcode-preview .retail-label")).toHaveCount(8);
    await all.uncheck(); await ui(page.locator(".barcode-preview .retail-label")).toHaveCount(0);
    await all.check(); await page.getByRole("button", { name: "التالي", exact: true }).click();
    await ui(page.getByRole("checkbox", { name: "اختيار VAR-3", exact: true })).toBeVisible(); await ui(all).not.toBeChecked();
    await all.check(); await all.uncheck();
    await page.getByRole("button", { name: "معاينة الملصقات", exact: true }).click();
    await ui(page.locator(".barcode-preview .retail-label")).toHaveCount(2);
    expect(printed.map((x) => x.variantId).sort()).toEqual(["1", "2"]);
    await page.getByRole("button", { name: "السابق", exact: true }).click(); await ui(one).toBeVisible(); await ui(all).toBeChecked();
    await page.getByRole("textbox", { name: "" }).first().fill("missing");
    await ui(all).toBeDisabled();
  } finally { await page.close(); }
});
