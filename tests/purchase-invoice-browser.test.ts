import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as ui, type Browser } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
let browser: Browser, web: PreviewServer, url: string;
const before = !!process.env.BEFORE_UI;
const order = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "PARTIAL",
  supplier: { name: "مورد تجريبي للملابس" },
  location: { name: "المخزن الرئيسي" },
  createdAt: "2026-11-23T10:00:00Z",
  items: [
    {
      id: "i1",
      quantity: 15,
      received: 10,
      unitCost: "2675.00",
      variant: {
        sku: "DRESS",
        options: { size: "12", color: "أزرق" },
        product: { nameAr: "فستان بناتي صيفي قطن مطبوع بالورود" },
      },
    },
    {
      id: "i2",
      quantity: 10,
      received: 0,
      unitCost: "997.00",
      variant: {
        sku: "SET",
        options: { size: "8", color: "وردي" },
        product: { nameAr: "طقم بناتي قطعتين بأكمام طويلة" },
      },
    },
  ],
  receipts: [
    { id: "r1", createdAt: "2026-11-23T10:30:00Z", total: "26750.00" },
  ],
};
beforeAll(async () => {
  web = await preview({
    root: resolve("apps/web"),
    preview: { host: "127.0.0.1", port: 0 },
  });
  url = `http://127.0.0.1:${(web.httpServer.address() as { port: number }).port}`;
  browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
  });
  await mkdir("test-results/purchase-invoice", { recursive: true });
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => web?.httpServer.close(() => done()));
});
describe("purchase invoice preview", () => {
  it.each([320, 390, 768, 1440])(
    "reads cleanly and keeps print at %spx",
    async (width) => {
      const context = await browser.newContext({
        viewport: { width, height: 1100 },
        deviceScaleFactor: 1,
      });
      try {
        await context.route("**/api/**", async (route) => {
          const path = new URL(route.request().url()).pathname;
          let data: unknown = [];
          if (path === "/api/auth/me")
            data = {
              id: "owner",
              name: "TEST Owner",
              roles: ["OWNER"],
              permissions: ["purchases.view", "purchases.preview"],
              csrf: "test",
            };
          else if (
            ["/api/branding", "/api/public/store", "/api/store"].includes(path)
          )
            data = { name: "A&Z Girls Fashion" };
          else if (path === "/api/purchases") data = [order];
          await route.fulfill({ json: { data } });
        });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(`${url}/purchases`);
        await page
          .getByRole("button", { name: "معاينة الفاتورة", exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await ui(dialog).toBeVisible();
        await ui(
          dialog.getByRole("button", { name: "طباعة الفاتورة", exact: true }),
        ).toBeVisible();
        await dialog.screenshot({
          path: `test-results/purchase-invoice/${before ? "before" : "after"}-${width}.png`,
        });
        if (!before) {
          await ui(dialog).not.toContainText("ج.م");
          await ui(dialog).toContainText("50,095.00 EGP");
          const pdf = dialog.getByRole("link", {
            name: "عرض PDF",
            exact: true,
          });
          await ui(pdf).toHaveAttribute(
            "href",
            `/api/purchases/${order.id}/pdf`,
          );
          await ui(pdf).toHaveAttribute("target", "_blank");
          expect(
            await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          ).toBe(true);
          const money =
            width <= 640
              ? dialog.locator(".invoice-mobile-items .invoice-money")
              : dialog.locator(".invoice-table .invoice-money");
          for (const el of await money.all()) {
            expect(
              await el.evaluate(
                (node) => node.scrollWidth <= node.clientWidth + 1,
              ),
            ).toBe(true);
            expect(
              await el.evaluate((node) => getComputedStyle(node).whiteSpace),
            ).toBe("nowrap");
          }
          await page.evaluate(() => {
            (window as any).__prints = 0;
            window.print = () => {
              (window as any).__prints++;
            };
          });
          await dialog
            .getByRole("button", { name: "طباعة الفاتورة", exact: true })
            .click();
          expect(await page.evaluate(() => (window as any).__prints)).toBe(1);
          await page.emulateMedia({ media: "print" });
          await ui(page.locator(".invoice-table")).toBeVisible();
          await ui(page.locator(".invoice-mobile-items")).toBeHidden();
          await ui(pdf).toBeHidden();
        }
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    },
  );
});
