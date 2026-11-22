import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as ui, type Browser, type BrowserContext } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
let browser: Browser;
let web: PreviewServer;
let url: string;
beforeAll(async () => {
  web = await preview({ root: resolve("apps/web"), preview: { host: "127.0.0.1", port: 0 } });
  url = `http://127.0.0.1:${(web.httpServer.address() as { port: number }).port}`;
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", headless: true });
  await mkdir("test-results/product-archive", { recursive: true });
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => web?.httpServer.close(() => done()));
});
async function mock(context: BrowserContext, mayArchive = true) {
  const products = [0, 3].map((quantity, index) => ({
    id: `test-product-${index}`, nameAr: quantity ? "TEST Stock Product" : "TEST Zero Product", sku: `TEST-${index}`,
    status: "ACTIVE", category: { name: "TEST Category" }, variants: [{
      id: `test-variant-${index}`, sku: `TEST-V${index}`, barcode: `123456789012${index}`, price: "120", minStock: 2,
      options: { Size: "M" }, balances: [{ quantity, location: { name: "TEST Warehouse" } }],
    }],
  }));
  const writes: string[] = [];
  await context.route("**/api/**", async (route) => {
    const req = route.request(), requestUrl = new URL(req.url()), path = requestUrl.pathname;
    let data: unknown = [];
    if (path === "/api/auth/me") data = {
      id: "test-owner", name: "TEST Owner", roles: ["OWNER"], permissions: ["products.view", ...(mayArchive ? ["products.archive", "products.update", "products.create"] : [])], csrf: "test-csrf",
    };
    else if (["/api/branding", "/api/public/store", "/api/store"].includes(path)) data = { name: "TEST Store", currency: "EGP" };
    else if (path === "/api/categories") data = requestUrl.searchParams.get("archived") === "1" ? [
      { id: "test-category-1", name: "TEST QA 2041 Renamed" },
      { id: "test-category-2", name: "TEST T7 Archive Cat" },
      { id: "test-category-3", name: "TEST قسم مؤرشف باسم طويل لاختبار ترتيب الأزرار على شاشة الهاتف الصغيرة" },
    ] : [
      { id: "test-category-active-1", name: "TEST Category" },
      { id: "test-category-active-2", name: "TEST Dresses Collection" },
      { id: "test-category-active-3", name: "TEST قسم باسم طويل لاختبار ترتيب أزرار تعديل وأرشفة الأقسام على الهاتف" },
    ];
    else if (path === "/api/products") {
      const archived = requestUrl.searchParams.get("archived") === "1", q = requestUrl.searchParams.get("q") ?? "";
      const rows = products.filter((product) => (product.status === "ARCHIVED") === archived && product.nameAr.includes(q));
      await route.fulfill({ json: { data: rows, total: rows.length } });
      return;
    } else if (req.method() === "POST" && /\/products\/.+\/(archive|restore)$/.test(path)) {
      writes.push(path);
      const product = products.find((product) => path.includes(`/${product.id}/`))!;
      if (path.endsWith("/archive") && product.variants[0].balances[0].quantity) {
        await route.fulfill({ status: 409, json: { error: { code: "PRODUCT_HAS_STOCK", message: "لا يمكن أرشفة المنتج: توجد كمية في المخزن." } } });
        return;
      }
      product.status = path.endsWith("/restore") ? "ACTIVE" : "ARCHIVED";
      data = { message: product.status === "ACTIVE" ? "تمت استعادة المنتج من الأرشيف." : "تمت أرشفة المنتج مع الاحتفاظ بسجلاته السابقة." };
    }
    await route.fulfill({ json: { data } });
  });
  return { products, writes };
}
describe("product archive and restore in the built UI", () => {
  it.each([1440, 390])("confirms, blocks stock, archives and restores at %spx", async (width) => {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    try {
      const { products, writes } = await mock(context);
      const page = await context.newPage(), errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${url}/products`);
      const zero = page.getByRole("row").filter({ hasText: "TEST Zero Product" });
      const stock = page.getByRole("row").filter({ hasText: "TEST Stock Product" });
      await ui(zero).toBeVisible();
      await ui(stock).toBeVisible();
      await zero.getByRole("button", { name: "أرشفة", exact: true }).click();
      let dialog = page.getByRole("dialog", { name: "أرشفة المنتج", exact: true });
      await ui(dialog).toContainText("TEST Zero Product");
      await ui(dialog).toContainText("قيد التحويل أو محجورة");
      expect(writes).toEqual([]);
      await page.screenshot({ animations: "disabled", path: `test-results/product-archive/confirm-${width}.png` });
      await dialog.getByRole("button", { name: "إلغاء", exact: true }).last().click();
      expect(writes).toEqual([]);
      await stock.getByRole("button", { name: "أرشفة", exact: true }).click();
      await page.getByRole("button", { name: "تأكيد الأرشفة", exact: true }).click();
      await ui(dialog.getByRole("alert")).toContainText("لا يمكن أرشفة المنتج");
      await ui(dialog).toBeVisible();
      const alertBox = await dialog.getByRole("alert").boundingBox();
      const buttons = await dialog.locator(".inline-actions button").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()));
      expect(alertBox).toBeTruthy();
      expect(buttons[0].top - (alertBox!.y + alertBox!.height)).toBeGreaterThanOrEqual(16);
      expect(Math.abs(buttons[0].width - buttons[1].width)).toBeLessThanOrEqual(1);
      expect(buttons[0].top).toBe(buttons[1].top);
      expect(products[1].status).toBe("ACTIVE");
      await page.screenshot({ animations: "disabled", path: `test-results/product-archive/blocked-${width}.png` });
      await dialog.getByRole("button", { name: "إلغاء", exact: true }).last().click();
      await zero.getByRole("button", { name: "أرشفة", exact: true }).click();
      await page.getByRole("button", { name: "تأكيد الأرشفة", exact: true }).click();
      await ui(dialog).not.toBeVisible();
      await ui(zero).toHaveCount(0);
      expect(products[0].status).toBe("ARCHIVED");
      await page.getByRole("button", { name: "أرشيف المنتجات", exact: true }).click();
      await ui(zero).toBeVisible();
      await ui(stock).toHaveCount(0);
      await ui(zero.getByRole("button", { name: "استعادة", exact: true })).toBeVisible();
      await page.screenshot({ animations: "disabled", path: `test-results/product-archive/archived-${width}.png` });
      await zero.getByRole("button", { name: "استعادة", exact: true }).click();
      dialog = page.getByRole("dialog", { name: "استعادة المنتج", exact: true });
      await ui(dialog).toContainText("سيظهر المنتج");
      await dialog.getByRole("button", { name: "تأكيد الاستعادة", exact: true }).click();
      await ui(dialog).not.toBeVisible();
      await ui(zero).toHaveCount(0);
      await page.getByRole("button", { name: "المنتجات الحالية", exact: true }).click();
      await ui(zero).toBeVisible();
      await ui(stock).toBeVisible();
      expect(writes).toEqual(["/api/products/test-product-1/archive", "/api/products/test-product-0/archive", "/api/products/test-product-0/restore"]);
      expect(products[0].status).toBe("ACTIVE");
      await page.reload();
      await ui(zero).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
      await page.screenshot({ animations: "disabled", path: `test-results/product-archive/restored-${width}.png` });
    } finally { await context.close(); }
  });
  it("keeps archive, restore and the archive tab hidden without archive permission", async () => {
    const context = await browser.newContext();
    try {
      await mock(context, false);
      const page = await context.newPage();
      await page.goto(`${url}/products`);
      await ui(page.getByRole("row").filter({ hasText: "TEST Zero Product" })).toBeVisible();
      for (const name of ["أرشفة", "استعادة", "أرشيف المنتجات"]) await ui(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    } finally { await context.close(); }
  });
  it.each([1440, 390])("aligns archived category restore buttons at %spx", async (width) => {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    try {
      await mock(context);
      const page = await context.newPage();
      await page.goto(`${url}/products`);
      await ui(page.getByRole("row").filter({ hasText: "TEST Zero Product" })).toBeVisible();
      await page.getByRole("button", { name: "التصنيف", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "التصنيفات", exact: true });
      const editButtons = dialog.getByTitle("تعديل اسم القسم", { exact: true });
      await ui(editButtons).toHaveCount(3);
      const activeBoxes = await editButtons.evaluateAll((elements) => elements.map((element) => {
        const rect = element.parentElement!.getBoundingClientRect();
        return { x: rect.x, width: rect.width, rowRight: element.closest("li")!.getBoundingClientRect().right };
      }));
      for (const box of activeBoxes) {
        expect(Math.abs(box.x - activeBoxes[0].x)).toBeLessThan(1);
        expect(box.width).toBe(96);
      }
      await page.screenshot({ animations: "disabled", path: `test-results/product-archive/sections-${width}.png` });
      await editButtons.first().click();
      await ui(dialog.getByRole("textbox", { name: "اسم القسم TEST Category", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ animations: "disabled", path: `test-results/product-archive/category-edit-${width}.png` });
      await dialog.getByRole("button", { name: "إلغاء", exact: true }).last().click();
      await dialog.getByTitle("حذف أو أرشفة القسم", { exact: true }).first().click();
      await ui(dialog.getByRole("button", { name: "تأكيد؟", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await dialog.getByRole("button", { name: "الأرشيف", exact: true }).click();
      const buttons = dialog.getByRole("button", { name: "استعادة", exact: true });
      await ui(buttons).toHaveCount(3);
      const boxes = await buttons.evaluateAll((elements) => elements.map((element) => {
        const rect = element.getBoundingClientRect();
        const row = element.closest("li")!.getBoundingClientRect();
        const name = element.closest("li")!.querySelector("span")!.getBoundingClientRect();
        return { x: rect.x, width: rect.width, height: rect.height, right: rect.right, rowLeft: row.left, rowRight: row.right, nameLeft: name.left, nameRight: name.right };
      }));
      for (const box of boxes) {
        expect(Math.abs(box.x - boxes[0].x)).toBeLessThan(1);
        expect(box.width).toBe(96);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.nameLeft - box.right).toBeGreaterThanOrEqual(15);
        expect(box.x).toBeGreaterThanOrEqual(box.rowLeft);
        expect(box.nameRight).toBeLessThanOrEqual(box.rowRight + 1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ animations: "disabled", path: `test-results/product-archive/categories-${width}.png` });
    } finally { await context.close(); }
  });
});
