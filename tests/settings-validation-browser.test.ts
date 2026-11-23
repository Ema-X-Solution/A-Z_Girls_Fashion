import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { chromium, expect as ui, type Browser } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
let browser: Browser, web: PreviewServer, url: string;
beforeAll(async () => {
  web = await preview({
    root: resolve("apps/web"),
    preview: { host: "127.0.0.1", port: 0 },
  });
  url = `http://127.0.0.1:${(web.httpServer.address() as { port: number }).port}`;
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL ?? "chromium",
    headless: true,
  });
  await mkdir("test-results/settings-validation", { recursive: true });
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => web?.httpServer.close(() => done()));
});
describe("settings field guidance", () => {
  it.each([390, 1440])(
    "keeps settings errors specific and decimals readable at %spx",
    async (width) => {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
      });
      let writes = 0;
      let sent: any;
      try {
        await context.route("**/api/**", async (route) => {
          const path = new URL(route.request().url()).pathname;
          let data: unknown = [];
          if (path === "/api/auth/me")
            data = {
              id: "11111111-1111-4111-8111-111111111111",
              name: "مدير تجريبي",
              roles: ["OWNER"],
              permissions: ["settings.manage"],
              csrf: "test",
            };
          else if (path === "/api/store")
            data = {
              name: "متجر تجريبي",
              currency: "EGP",
              timezone: "Africa/Cairo",
              address: "",
              phone: "",
              taxRate: "14",
              returnDays: 14,
              receiptFooter: "TEST footer unchanged",
              receiptWidth: 80,
              taxMode: "INCLUSIVE",
              showTaxOnInvoice: true,
              invoicePrefix: "INV",
              returnPolicy: "TEST original policy unchanged",
            };
          else if (
            path === "/api/loyalty/settings" &&
            route.request().method() === "GET"
          )
            data = {
              enabled: false,
              spendPerPoint: 3.3299999237060547,
              pointValue: "0.50",
              expiryDays: 365,
              maxRedeemPercent: 20,
              minimumRedeemPoints: 1,
            };
          else if (path === "/api/branding" || path === "/api/public/store")
            data = { name: "متجر تجريبي" };
          else if (path === "/api/settings/store") {
            writes++;
            sent = route.request().postDataJSON();
            await route.fulfill({
              status: 400,
              json: {
                error: {
                  code: "VALIDATION",
                  message: "Invalid request",
                  fields: {
                    fieldErrors: {
                      returnDays: [
                        process.env.BEFORE_UI
                          ? "Number must be less than or equal to 365"
                          : "فترة الاسترجاع يجب ألا تزيد عن 365 يومًا.",
                      ],
                    },
                  },
                },
              },
            });
            return;
          }
          await route.fulfill({ json: { data } });
        });
        const page = await context.newPage();
        page.setDefaultTimeout(7000);
        await page.goto(`${url}/settings`);
        const days = page.getByLabel("فترة الاسترجاع بالأيام", { exact: true });
        await days.fill(process.env.BEFORE_UI ? "366" : "365");
        await page.getByRole("button", { name: "حفظ", exact: true }).click();
        await ui.poll(() => writes).toBe(1);
        await page.screenshot({
          path: `test-results/settings-validation/${process.env.BEFORE_UI ? "before" : "after"}-error-${width}.png`,
        });
        if (process.env.BEFORE_UI) return;
        await ui(page.getByRole("alert")).toContainText(
          "فترة الاسترجاع يجب ألا تزيد عن 365",
        );
        await ui(page.locator(".toast-error")).toHaveCount(0);
        expect(sent.taxMode).toBe("INCLUSIVE");
        expect(sent.showTaxOnInvoice).toBe(true);
        expect(sent.returnPolicy).toBe("TEST original policy unchanged");
        expect(sent.receiptFooter).toBe("TEST footer unchanged");
        await ui(
          page.getByLabel("مبلغ الشراء لكل نقطة (EGP)", { exact: true }),
        ).toHaveValue("3.33");
        await days.fill("366");
        await page.getByRole("button", { name: "حفظ", exact: true }).click();
        await ui(page.getByRole("alert")).toContainText("365");
        expect(writes).toBe(1);
        await page.screenshot({
          path: `test-results/settings-validation/after-error-${width}.png`,
        });
        await days.fill("1.5");
        await page.getByRole("button", { name: "حفظ", exact: true }).click();
        await ui(page.getByRole("alert")).toContainText("عددًا صحيحًا");
        expect(writes).toBe(1);
        await days.fill("14");
        const prefix = page.getByLabel("بادئة رقم الفاتورة", { exact: true });
        await prefix.fill("بادئة");
        await page.getByRole("button", { name: "حفظ", exact: true }).click();
        await ui(page.getByRole("alert")).toContainText("حرفًا إنجليزيًا");
        expect(writes).toBe(1);
        await ui(
          page.getByLabel("رسالة الإيصال", { exact: true }),
        ).toHaveAttribute("maxlength", "1000");
        await ui(
          page.getByLabel("سياسة الاستبدال والاسترجاع المطبوعة", {
            exact: true,
          }),
        ).toHaveAttribute("maxlength", "5000");
        const spend = page.getByLabel("مبلغ الشراء لكل نقطة (EGP)", {
          exact: true,
        });
        await spend.fill("0");
        await page
          .getByRole("button", { name: "حفظ إعدادات الولاء", exact: true })
          .click();
        expect(
          await spend.evaluate((el: HTMLInputElement) => el.validationMessage),
        ).toContain("1");
        expect(
          await spend.evaluate((el: HTMLInputElement) => el.validationMessage),
        ).not.toContain("سالب");
      } finally {
        await context.close();
      }
    },
  );
});
