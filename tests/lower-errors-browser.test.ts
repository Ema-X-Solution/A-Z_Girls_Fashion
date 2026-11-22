import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as ui, type Browser } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
let browser: Browser, web: PreviewServer, url: string;
const id = "11111111-1111-4111-8111-111111111111";
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
  await mkdir("test-results/lower-errors", { recursive: true });
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => web?.httpServer.close(() => done()));
});
describe("audit names and expense error lifecycle", () => {
  it.each([390, 1440])(
    "keeps Arabic errors scoped to their dialog at %spx",
    async (width) => {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
      });
      try {
        await context.route("**/api/**", async (route) => {
          const path = new URL(route.request().url()).pathname;
          let data: unknown = [];
          if (path === "/api/auth/me")
            data = {
              id,
              name: "مدير تجريبي",
              roles: ["OWNER"],
              permissions: [
                "expenses.view",
                "expenses.create",
                "expenses.approve",
                "audit.view",
                "sales.view_all",
              ],
              csrf: "test",
            };
          else if (path === "/api/expenses")
            data = [
              {
                id,
                date: "2026-11-01T10:00:00Z",
                category: "نقل تجريبي",
                description: "مصروف تجريبي محلي",
                amount: "12.30",
                method: "BANK",
                status: "APPROVED",
              },
            ];
          else if (
            path === "/api/expense-categories" &&
            route.request().method() === "POST"
          ) {
            await route.fulfill({
              status: 409,
              json: {
                error: { code: "P2002", message: "Unique constraint failed" },
              },
            });
            return;
          } else if (path === "/api/expense-categories")
            data = [{ id, name: "نقل تجريبي", active: true }];
          else if (path === "/api/audit-logs")
            data = [
              {
                id,
                userId: id,
                userName: "مدير تجريبي",
                action: "PROMOTION_CREATED",
                entityId: "test",
                createdAt: "2026-11-01T10:00:00Z",
              },
              {
                id: "deleted",
                userId: "22222222-2222-4222-8222-222222222222",
                userName: null,
                action: "EXPENSE_SUBMITTED",
                createdAt: "2026-11-01T10:00:00Z",
              },
              {
                id: "system",
                userId: null,
                userName: null,
                action: "LOGIN",
                createdAt: "2026-11-01T10:00:00Z",
              },
            ];
          else if (
            ["/api/store", "/api/branding", "/api/public/store"].includes(path)
          )
            data = { name: "متجر تجريبي محلي" };
          await route.fulfill({ json: { data } });
        });
        const page = await context.newPage();
        page.setDefaultTimeout(7000);
        await page.goto(`${url}/expenses`);
        await page
          .getByRole("button", { name: "تفاصيل ومرفقات", exact: true })
          .click();
        const details = page.getByRole("dialog", {
          name: "تفاصيل المصروف",
          exact: true,
        });
        await details
          .locator('input[type="file"]')
          .setInputFiles({
            name: "test.png",
            mimeType: "image/png",
            buffer: Buffer.alloc(750001),
          });
        await ui(details.getByRole("alert")).toContainText("750");
        if (!process.env.BEFORE_UI)
          await ui(page.getByRole("alert")).toHaveCount(1);
        await details
          .getByRole("button", { name: "إلغاء", exact: true })
          .click();
        await page
          .getByRole("button", { name: "طلب مصروف جديد", exact: true })
          .click();
        const form = page.getByRole("dialog", {
          name: "طلب مصروف جديد",
          exact: true,
        });
        await page.screenshot({
          path: `test-results/lower-errors/${process.env.BEFORE_UI ? "before" : "after"}-expense-${width}.png`,
        });
        if (process.env.BEFORE_UI) return;
        await ui(page.getByRole("alert")).toHaveCount(0);
        await form
          .getByLabel("التصنيف", { exact: true })
          .selectOption({ label: "نقل تجريبي" });
        const amount = form.getByLabel("القيمة", { exact: true });
        await amount.fill("0");
        await form
          .getByLabel("الوصف والسبب", { exact: true })
          .fill("مصروف محلي تجريبي");
        await form
          .getByRole("button", { name: "حفظ المصروف", exact: true })
          .click();
        expect(
          await amount.evaluate((el: HTMLInputElement) => el.validationMessage),
        ).toContain("0.01");
        expect(
          await amount.evaluate((el: HTMLInputElement) => el.validationMessage),
        ).not.toContain("سالب");
        await amount.fill("12.30");
        expect(
          await amount.evaluate((el: HTMLInputElement) => el.validationMessage),
        ).toBe("");
        await form.getByRole("button", { name: "إلغاء", exact: true }).click();
        await page
          .getByRole("button", { name: "تصنيفات المصروفات", exact: true })
          .click();
        const categories = page.getByRole("dialog", {
          name: "تصنيفات المصروفات",
          exact: true,
        });
        await categories
          .getByLabel("اسم تصنيف جديد", { exact: true })
          .fill("نقل تجريبي");
        await categories
          .getByRole("button", { name: "إضافة التصنيف", exact: true })
          .click();
        await ui(categories.getByRole("alert")).toContainText("مسجلة بالفعل");
        await ui(page.getByRole("alert")).toHaveCount(1);
        await categories
          .getByRole("button", { name: "إلغاء", exact: true })
          .click();
        await ui(page.getByRole("alert")).toHaveCount(0);
        await page.goto(`${url}/audit-logs`);
        await ui(
          page.getByRole("cell", { name: "مدير تجريبي", exact: true }),
        ).toBeVisible();
        await ui(
          page.getByRole("cell", { name: "إنشاء عرض", exact: true }),
        ).toBeVisible();
        await ui(
          page.getByRole("cell", { name: "طلب مراجعة مصروف", exact: true }),
        ).toBeVisible();
        await ui(
          page.getByRole("cell", { name: "النظام", exact: true }),
        ).toBeVisible();
        await ui(
          page.getByText("مستخدم غير متاح (22222222)", { exact: true }),
        ).toBeVisible();
        await page.screenshot({
          path: `test-results/lower-errors/after-audit-${width}.png`,
        });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      } finally {
        await context.close();
      }
    },
  );
});
