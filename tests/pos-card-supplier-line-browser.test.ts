import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, expect as expect_, type Browser } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";

const userId = "11111111-1111-4111-8111-111111111111";
const shiftId = "22222222-2222-4222-8222-222222222222";
const locationId = "33333333-3333-4333-8333-333333333333";
let browser: Browser, web: PreviewServer, url: string;
const names = ["فستان صيفي", "بلوزة قطن", "جاكيت جينز", "تنورة بليسيه", "طقم رياضي", "شنطة يد"];
const products = names.map((nameAr, i) => ({
  id: `p${i}`,
  nameAr,
  status: "ACTIVE",
  imageUrl: null,
  category: { name: "ملابس" },
  primarySupplier: i === 3 ? null : { code: i % 2 ? "SUP-0002" : "SUP-0001" },
  variants: [
    {
      id: `v${i}`,
      sku: `SKU-${i}`,
      barcode: `20123456789${i}`,
      active: true,
      price: "250.00",
      minStock: 2,
      options: i === 3 || i === 4 ? {} : i === 5 ? { "اللون": "بيج" } : { "اللون": "أسود", "المقاس": "M" },
      balances: [{ locationId, quantity: 5 + i }],
    },
  ],
}));
beforeAll(async () => {
  web = await preview({ root: resolve("apps/web"), preview: { host: "127.0.0.1", port: 0 } });
  url = `http://127.0.0.1:${(web.httpServer.address() as { port: number }).port}`;
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE ?? "/usr/bin/google-chrome", headless: true });
  await mkdir("test-results/pos-card-supplier-line", { recursive: true });
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => web?.httpServer.close(() => done()));
});
it("writes supplier code, size and color as text on POS product cards", async () => {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1470, height: 900 } });
    await context.addInitScript((t) => localStorage.setItem("theme", t), theme);
    await context.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
      let json: unknown = [];
      if (path === "/auth/me")
        json = { id: userId, name: "مدير", email: "o@example.test", roles: ["OWNER"], csrf: "x", discountLimit: "100", permissions: ["pos.access", "sales.view", "products.view", "shifts.manage", "inventory.view"] };
      else if (path === "/sales/cashiers") json = [{ id: userId, name: "مدير" }];
      else if (path === "/shifts/current") json = { id: shiftId, register: { id: "register", locationId } };
      else if (path === "/store" || path === "/public/store" || path === "/branding") json = { name: "A&Z Girls Fashion", taxRate: "0", taxMode: "EXCLUSIVE" };
      else if (path === "/products") json = products;
      await route.fulfill({ status: 200, json: { data: json } });
    });
    const page = await context.newPage();
    await page.goto(`${url}/pos`);
    await page.locator(".catalog-item").first().waitFor();
    const line = (n: number) => page.locator(".catalog-item").nth(n).locator(".card-options-line");
    await expect_(line(0).locator(".card-supplier")).toHaveText("SUP-0001");
    await expect_(line(0).locator(".card-size")).toHaveText("M");
    await expect_(line(0).locator(".card-color")).toHaveText("أسود");
    expect(await line(3).count()).toBe(0);
    await expect_(line(4).locator(".card-supplier")).toHaveText("SUP-0001");
    expect(await page.locator(".supplier-barcode").count()).toBe(0);
    await page.screenshot({ path: `test-results/pos-card-supplier-line/pos-${theme}.png` });
    await context.close();
  }
}, 60000);
