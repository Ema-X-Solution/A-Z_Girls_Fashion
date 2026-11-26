import { afterAll, beforeAll, expect, it } from "vitest";
import { chromium, expect as expect_, type Browser } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";

const userId = "11111111-1111-4111-8111-111111111111";
const shiftId = "22222222-2222-4222-8222-222222222222";
const locationId = "33333333-3333-4333-8333-333333333333";
let browser: Browser, web: PreviewServer, url: string;
const names = [
  "فستان صيفي",
  "بلوزة قطن",
  "جاكيت جينز",
  "تنورة بليسيه",
  "طقم رياضي",
  "شنطة يد",
];
const products = names.map((nameAr, i) => ({
  id: `p${i}`,
  nameAr,
  status: "ACTIVE",
  imageUrl: null,
  category: { name: "ملابس" },
  primarySupplier: i === 3 ? null : { code: i % 2 ? "SUP-0002" : "SUP-0001" },
  variants: [
    {
      id: `44444444-4444-4444-8444-44444444444${i}`,
      sku: `SKU-${i}`,
      barcode: `20123456789${i}`,
      active: true,
      price: "250.00",
      minStock: 2,
      options:
        i === 3 || i === 4
          ? {}
          : i === 5
            ? { اللون: "بيج" }
            : { اللون: "أسود", المقاس: "M" },
      balances: [{ locationId, quantity: 5 + i }],
    },
  ],
}));
beforeAll(async () => {
  web = await preview({
    root: resolve("apps/web"),
    preview: { host: "127.0.0.1", port: 0 },
  });
  url = `http://127.0.0.1:${(web.httpServer.address() as { port: number }).port}`;
  browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE ?? "/usr/bin/google-chrome",
    headless: true,
  });
  await mkdir("test-results/pos-scanner-autoadd", { recursive: true });
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => web?.httpServer.close(() => done()));
});
it("adds a scanned barcode with no Enter, rescan increments, hand typing does not auto-add", async () => {
  const context = await browser.newContext({
    viewport: { width: 1470, height: 900 },
  });
  await context.addInitScript(() => {
    localStorage.setItem("theme", "light");
    (window as any).__beeps = 0;
    const Real = window.AudioContext;
    (window as any).AudioContext = class extends Real {
      createOscillator() {
        (window as any).__beeps++;
        return super.createOscillator();
      }
    };
  });
  await context.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    let json: unknown = [];
    if (path === "/auth/me")
      json = {
        id: userId,
        name: "مدير",
        email: "o@example.test",
        roles: ["OWNER"],
        csrf: "x",
        discountLimit: "100",
        permissions: [
          "pos.access",
          "sales.view",
          "products.view",
          "shifts.manage",
          "inventory.view",
        ],
      };
    else if (path === "/sales/cashiers") json = [{ id: userId, name: "مدير" }];
    else if (path === "/shifts/current")
      json = { id: shiftId, register: { id: "register", locationId } };
    else if (
      path === "/store" ||
      path === "/public/store" ||
      path === "/branding"
    )
      json = { name: "A&Z Girls Fashion", taxRate: "0", taxMode: "EXCLUSIVE" };
    else if (path === "/products") json = products;
    else if (path.startsWith("/barcodes/") && path.endsWith("/lookup")) {
      const code = decodeURIComponent(path.split("/")[2]);
      const p = products.find((x) => x.variants[0].barcode === code);
      if (!p)
        return route.fulfill({
          status: 404,
          json: { error: "الباركود غير موجود" },
        });
      const v = p.variants[0];
      json = {
        id: v.id,
        sku: v.sku,
        barcode: v.barcode,
        price: v.price,
        options: v.options,
        active: true,
        balances: v.balances,
        product: { nameAr: p.nameAr },
      };
    }
    await route.fulfill({ status: 200, json: { data: json } });
  });
  const page = await context.newPage();
  await page.goto(`${url}/pos`);
  const scanner = page.getByLabel("مسح الباركود");
  await scanner.waitFor();
  await expect_(scanner).toBeFocused();
  // scanner: fast keystrokes, no Enter
  await page.keyboard.type("201234567890", { delay: 3 });
  await page.waitForTimeout(1000);
  await expect_(page.getByText("فستان صيفي").nth(1)).toBeVisible({
    timeout: 3000,
  });
  await expect_(scanner).toHaveValue("");
  await expect_(scanner).toBeFocused();
  await page.screenshot({
    path: "test-results/pos-scanner-autoadd/1-first-scan.png",
  });
  const stored = () =>
    page.evaluate(() =>
      Object.entries(localStorage)
        .filter(([k]) => k.startsWith("az-pos:v1:"))
        .map(([, v]) => v)
        .join(""),
    );
  const qty = async (n: number) =>
    expect(await stored()).toContain(`"quantity":${n}`);
  await qty(1);
  expect(await page.evaluate(() => (window as any).__beeps)).toBe(1);
  await page.keyboard.type("201234567890", { delay: 3 });
  await page.waitForTimeout(600);
  await qty(2);
  await page.screenshot({
    path: "test-results/pos-scanner-autoadd/2-rescan-qty2.png",
  });
  // click elsewhere: cursor returns to the scanner field
  await page
    .locator("h1, .page-title, main")
    .first()
    .click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(100);
  await expect_(scanner).toBeFocused();
  // slow hand typing is not auto-added
  await page.keyboard.type("201234567891", { delay: 200 });
  await page.waitForTimeout(500);
  await expect_(scanner).toHaveValue("201234567891");
  await qty(2);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  await expect_(scanner).toHaveValue("");
  await page.screenshot({
    path: "test-results/pos-scanner-autoadd/3-manual-enter.png",
  });
  await context.close();
}, 60000);
