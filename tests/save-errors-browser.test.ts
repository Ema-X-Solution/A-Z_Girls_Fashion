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
  await mkdir("test-results/save-errors", { recursive: true });
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => web?.httpServer.close(() => done()));
});
describe("persistent Arabic save failures", () => {
  it.each([1440, 390])(
    "keeps duplicate role and customer errors in the open dialog at %spx",
    async (width) => {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
      });
      let roleWrites = 0;
      try {
        await context.route("**/api/**", async (route) => {
          const req = route.request(),
            path = new URL(req.url()).pathname;
          let data: unknown = [];
          if (path === "/api/auth/me")
            data = {
              id,
              name: "TEST Owner",
              roles: ["OWNER"],
              permissions: [
                "settings.manage",
                "sales.discount_approve",
                "sales.view_all",
                "roles.manage",
                "users.manage",
                "customers.manage",
                "dashboard.view",
              ],
              discountLimit: "50",
              csrf: "test",
            };
          else if (path === "/api/discount-approvals")
            data = [
              {
                id: "test-approval",
                requesterId: "other",
                requesterName: "TEST Cashier",
                reason: "TEST high discount",
                subtotal: "120",
                discount: "75.60",
                total: "44.40",
                status: "PENDING",
                expiresAt: "2099-01-01T00:00:00Z",
                input: { items: [] },
              },
            ];
          else if (path.endsWith("/decision")) {
            await route.fulfill({
              status: 403,
              json: {
                error: {
                  code: "APPROVER_LIMIT",
                  message: "الخصم المطلوب يتجاوز حد الموافقة المسموح لك به.",
                },
              },
            });
            return;
          } else if (path === `/api/customers/${id}/history`)
            data = {
              customer: { id, phone: "01012345678", discountPercent: "5" },
              sales: [],
              returns: [],
              total: 0,
              returnCount: 0,
              summary: {
                purchaseCount: 0,
                purchases: "0",
                returns: "0",
                netSpending: "0",
              },
            };
          else if (path === `/api/customers/${id}/loyalty`)
            data = { balance: 0, available: 0, debt: 0, entries: [], total: 0 };
          else if (path === "/api/customers" && req.method() === "GET")
            data = [{ id, name: "TEST Customer", phone: "01012345678" }];
          else if (path === "/api/permissions") data = ["sales.create"];
          else if (path === "/api/roles" && req.method() === "POST") {
            roleWrites++;
            await route.fulfill({
              status: 409,
              json: {
                error: {
                  code: "ROLE_NAME_EXISTS",
                  message: "اسم الدور مسجل بالفعل. اختر اسمًا آخر.",
                },
              },
            });
            return;
          } else if (path === "/api/customers" && req.method() === "POST") {
            const body = req.postDataJSON();
            await route.fulfill({
              status: body.phone === "123" ? 400 : 409,
              json: {
                error:
                  body.phone === "123"
                    ? {
                        code: "VALIDATION",
                        message: "Invalid request",
                        fields: {
                          fieldErrors: {
                            phone: ["اكتب رقم تليفون صحيحًا وكاملًا"],
                          },
                        },
                      }
                    : {
                        code: "CUSTOMER_PHONE_EXISTS",
                        message: "رقم التليفون مسجل بالفعل لعميل آخر",
                      },
              },
            });
            return;
          } else if (
            ["/api/store", "/api/branding", "/api/public/store"].includes(path)
          )
            data = { name: "TEST Store" };
          await route.fulfill({ json: { data } });
        });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        await page.goto(`${url}/roles`);
        await page
          .getByRole("button", { name: "دور جديد", exact: true })
          .click();
        const dialog = page.getByRole("dialog", {
          name: "دور جديد",
          exact: true,
        });
        await dialog
          .getByLabel("اسم الدور", { exact: true })
          .fill("TEST Duplicate");
        await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
        await ui.poll(() => roleWrites).toBe(1);
        await page.screenshot({
          path: `test-results/save-errors/${process.env.BEFORE_UI ? "before" : "after"}-role-${width}.png`,
        });
        if (process.env.BEFORE_UI) return;
        await ui(dialog.getByRole("alert")).toContainText(
          "اسم الدور مسجل بالفعل",
        );
        await page.screenshot({
          path: `test-results/save-errors/after-role-${width}.png`,
        });
        await ui(dialog.getByLabel("اسم الدور", { exact: true })).toHaveValue(
          "TEST Duplicate",
        );
        await ui(page.locator(".toast-error")).toHaveCount(0);
        await dialog
          .getByRole("button", { name: "إلغاء", exact: true })
          .click();
        await page
          .getByRole("button", { name: "دور جديد", exact: true })
          .click();
        await ui(dialog.getByRole("alert")).toHaveCount(0);
        await page.goto(`${url}/customers`);
        await page.getByRole("button", { name: "إضافة", exact: true }).click();
        const customer = page.getByRole("dialog", {
          name: "إضافة",
          exact: true,
        });
        for (const [phone, message] of [
          ["123", "رقم تليفون صحيحًا"],
          ["01012345678", "مسجل بالفعل"],
        ]) {
          await customer.getByLabel("الهاتف", { exact: true }).fill(phone);
          await customer
            .getByRole("button", { name: "حفظ", exact: true })
            .click();
          await ui(customer.getByRole("alert")).toContainText(message);
          await ui(customer.getByLabel("الهاتف", { exact: true })).toHaveValue(
            phone,
          );
        }
        await page.screenshot({
          path: `test-results/save-errors/after-customer-${width}.png`,
        });
        await customer
          .getByRole("button", { name: "إلغاء", exact: true })
          .click();
        await page
          .getByRole("button", { name: "سجل العميل", exact: true })
          .click();
        const history = page
          .getByRole("dialog")
          .filter({ hasText: "خصم العميل الدائم" });
        await history
          .getByLabel("نسبة خصم العميل (%)", { exact: true })
          .fill("150");
        await history
          .getByRole("button", { name: "حفظ خصم العميل", exact: true })
          .click();
        await ui(history.getByRole("alert")).toContainText("0 إلى 100");
        await page.screenshot({
          path: `test-results/save-errors/after-discount-${width}.png`,
        });
        await page.goto(`${url}/discount-approvals`);
        await page
          .getByRole("button", { name: "مراجعة الطلب", exact: true })
          .click();
        const review = page.getByRole("dialog", {
          name: "مراجعة الخصم",
          exact: true,
        });
        await review
          .getByLabel("ملاحظة القرار", { exact: true })
          .fill("TEST approve");
        await review
          .getByRole("button", { name: "الموافقة على الخصم", exact: true })
          .click();
        await ui(review.getByRole("alert")).toContainText("حد موافقتك");
        await ui(page.getByRole("alert")).toHaveCount(1);
        await ui(
          review.getByRole("button", {
            name: "الموافقة على الخصم",
            exact: true,
          }),
        ).toBeEnabled();
        await page.screenshot({
          path: `test-results/save-errors/after-approval-${width}.png`,
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
