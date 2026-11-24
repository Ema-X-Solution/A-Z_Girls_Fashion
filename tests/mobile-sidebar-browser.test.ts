import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as ui, type Browser } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { resolve } from "node:path";
let browser: Browser;
let web: PreviewServer;
let url: string;
beforeAll(async () => {
  web = await preview({ root: resolve("apps/web"), preview: { host: "127.0.0.1", port: 0 } });
  url = `http://127.0.0.1:${(web.httpServer.address() as { port: number }).port}`;
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? "msedge", headless: true });
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => web?.httpServer.close(() => done()));
});
async function openShell(theme: string, width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true });
  await context.addInitScript((value) => localStorage.setItem("az-theme", value), theme);
  const page = await context.newPage();
  await context.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: { data: {
      id: "11111111-1111-4111-8111-111111111111", name: "عرض تجريبي", email: "demo@example.test",
      roles: ["OWNER"], permissions: ["dashboard.view", "pos.access", "products.view", "inventory.view", "purchases.view", "suppliers.manage", "sales.view_own", "customers.manage", "expenses.view", "cash.close_shift", "reports.sales", "reports.profit", "settings.manage", "users.manage", "roles.manage"], csrf: "fixture", discountLimit: "0"
    } } });
    if (path === "/api/branding") return route.fulfill({ json: { data: { logoUrl: "/brand/az-logo.jpg" } } });
    if (path === "/api/reports/dashboard") return route.fulfill({ json: { data: { totalSalesWithTax: "0", orders: 0, returns: "0", netSales: "0", discounts: "0", tax: "0", daily: [], cashiers: [] } } });
    if (path.includes("/reports/detail/")) return route.fulfill({ json: { title: "المبيعات اليومية", total: 0, columns: [], data: [] } });
    return route.fulfill({ json: { data: [] } });
  });
  await page.goto(`${url}/reports`);
  await page.locator(".brand img").waitFor({ state: "attached" });
  await page.evaluate(() => document.fonts.ready);
  return { page, context };
}
describe("mobile sidebar without a close icon", () => {
  for (const theme of ["dark", "light"]) {
    it(`${theme}: opens without X or displaced branding, closes outside, reopens and closes on navigation`, async () => {
      const { page, context } = await openShell(theme);
      try {
        const toggle = page.locator(".mobile-toggle");
        await toggle.tap();
        await ui(page.locator(".sidebar")).toHaveClass(/mobile-open/);
        await ui(toggle).toHaveAttribute("aria-expanded", "true");
        await ui(page.locator(".sidebar .lucide-x, .mobile-toggle .lucide-x")).toHaveCount(0);
        const box = await page.locator(".brand").boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(148);
        expect(await page.locator(".brand").evaluate((el) => getComputedStyle(el).paddingInlineStart)).not.toBe("52px");
        await ui(page.locator(".sidebar")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
        if (process.env.SIDEBAR_SHOTS) await page.screenshot({ path: `/downloads/sidebar-no-x-open-${theme}.png` });
        const covered = await toggle.evaluate((el) => { const r = el.getBoundingClientRect(); return !el.contains(document.elementFromPoint(r.x+r.width/2, r.y+r.height/2)); });
        expect(covered).toBe(true);
        await page.touchscreen.tap(60, 420);
        await ui(page.locator(".sidebar")).not.toHaveClass(/mobile-open/);
        await ui(toggle).toHaveAttribute("aria-expanded", "false");
        await ui(page.locator(".sidebar")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 242, 0)");
        if (process.env.SIDEBAR_SHOTS) await page.screenshot({ path: `/downloads/sidebar-no-x-closed-${theme}.png` });
        await toggle.tap();
        await page.locator('.sidebar a[href="/dashboard"]').last().tap();
        await ui(page.locator(".sidebar")).not.toHaveClass(/mobile-open/);
        await ui(page.locator(".sidebar-backdrop")).toHaveCount(0);
      } finally { await context.close(); }
    });
    it(`${theme}: desktop branding stays visible without a backdrop`, async () => {
      const { page, context } = await openShell(theme, 1440);
      try {
        await ui(page.locator(".brand")).toBeVisible();
        await ui(page.locator(".mobile-toggle")).toBeHidden();
        await ui(page.locator(".sidebar-backdrop")).toHaveCount(0);
      } finally { await context.close(); }
    });
  }
});
