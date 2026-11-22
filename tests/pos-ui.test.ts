import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  chromium,
  expect as ui,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  emptyWorkspace,
  workspaceKey,
} from "../apps/web/src/features/pos/workspace";

const userId = "11111111-1111-4111-8111-111111111111";
const shiftId = "22222222-2222-4222-8222-222222222222";
const locationId = "33333333-3333-4333-8333-333333333333";
const customerId = "44444444-4444-4444-8444-444444444444";
const variantId = "55555555-5555-4555-8555-555555555555";
const product = {
  id: "66666666-6666-4666-8666-666666666666",
  nameAr: "TEST فستان صيفي",
  status: "ACTIVE",
  imageUrl: null,
  category: { name: "فساتين" },
  variants: [
    {
      id: variantId,
      sku: "POS-UI-2",
      barcode: "999001",
      active: true,
      price: "200.00",
      minStock: 1,
      options: { color: "أزرق", size: "M" },
      balances: [
        { locationId, quantity: 2 },
        { locationId: "other", quantity: 50 },
      ],
    },
  ],
};
const soldOut = {
  ...product,
  id: "77777777-7777-4777-8777-777777777777",
  nameAr: "TEST صنف نفد في فرع البيع",
  variants: [
    {
      ...product.variants[0]!,
      id: "88888888-8888-4888-8888-888888888888",
      sku: "POS-UI-ZERO",
      barcode: "999002",
      balances: [
        { locationId, quantity: 0 },
        { locationId: "other", quantity: 20 },
      ],
    },
  ],
};
type Harness = {
  context: BrowserContext;
  page: Page;
  sales: { key: string | undefined; body: unknown }[];
  rejectQuote: boolean;
  loseSale: boolean;
};
let browser: Browser, web: PreviewServer, url: string;
const contexts: BrowserContext[] = [];
async function mount({
  width = 1470,
  height = 780,
  shift = true,
  filled = true,
  customer = true,
  invalidDraft = false,
} = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  contexts.push(context);
  const draft = emptyWorkspace();
  if (filled)
    draft.active.items = [
      {
        variant: {
          ...product.variants[0]!,
          product: { nameAr: product.nameAr },
        },
        quantity: 1,
      },
    ];
  if (customer) {
    draft.active.customer = customerId;
    draft.active.customerSearch = "01012340001";
  }
  if (invalidDraft)
    draft.active.payments[0]!.authorizationCode = "invalid<script>";
  await context.addInitScript(
    ({ key, value }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, value);
    },
    { key: workspaceKey(userId), value: JSON.stringify(draft) },
  );
  const h: Harness = {
    context,
    page: await context.newPage(),
    sales: [],
    rejectQuote: false,
    loseSale: false,
  };
  await context.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname.replace(/^\/api/, "");
    let data: unknown = null;
    if (path === "/auth/me")
      data = {
        id: userId,
        name: "TEST Owner",
        email: "owner@example.test",
        roles: ["OWNER"],
        permissions: [
          "reports.sales",
          "cash.close_shift",
          "pos.access",
          "sales.view",
          "products.view",
          "shifts.manage",
          "dashboard.view",
          "inventory.view",
        ],
        csrf: "fixture-csrf",
        discountLimit: "100",
      };
    else if (path === "/shifts/current")
      data = shift
        ? { id: shiftId, register: { id: "register", locationId } }
        : null;
    else if (
      path === "/store" ||
      path === "/public/store" ||
      path === "/branding"
    )
      data = { name: "A&Z Girls Fashion", taxRate: "0", taxMode: "EXCLUSIVE" };
    else if (path === "/products") data = [product, soldOut];
    else if (path.startsWith("/customers"))
      data =
        path === `/customers/${customerId}`
          ? { id: customerId, name: "TEST عميل", phone: "01012340001" }
          : [{ id: customerId, name: "TEST عميل", phone: "01012340001" }];
    else if (path.startsWith("/barcodes/"))
      data = {
        ...(path.includes("999002") ? soldOut : product).variants[0],
        product: { nameAr: product.nameAr },
      };
    else if (path === "/sales/quote") {
      if (h.rejectQuote)
        return route.fulfill({
          status: 400,
          json: {
            error: {
              code: "INVALID_DISCOUNT",
              message: "Discount exceeds available amount",
            },
          },
        });
      const body = request.postDataJSON(),
        quantity = body.items.reduce(
          (sum: number, row: { quantity: number }) => sum + row.quantity,
          0,
        ),
        total = (quantity * 200).toFixed(2);
      data = {
        subtotal: total,
        discount: "0",
        netBeforeTax: total,
        tax: "0",
        total,
        taxRate: "0",
        items: body.items.map((row: object) => ({
          ...row,
          unitPrice: "200.00",
        })),
      };
    } else if (path === "/sales" && request.method() === "POST") {
      h.sales.push({
        key: request.headers()["idempotency-key"],
        body: request.postDataJSON(),
      });
      if (h.loseSale) return route.abort("failed");
      return route.fulfill({
        status: 409,
        json: {
          error: {
            code: "INSUFFICIENT_STOCK",
            message: "الكمية المطلوبة أكبر من المخزون المتاح",
          },
        },
      });
    } else if (path.includes("/checkout-attempts/"))
      data = { status: path.endsWith("/cancel") ? "CANCELLED" : "NOT_FOUND" };
    await route.fulfill({ status: 200, json: { data } });
  });
  h.page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await h.page.goto(url + "/pos");
  await ui(h.page.locator(".catalog-item").first())
    .toBeVisible()
    .catch(async (e) => {
      console.log(await h.page.locator("body").innerText());
      throw e;
    });
  await ui(h.page.getByLabel("مسح الباركود")).toBeEnabled();
  if (filled && shift && customer && !invalidDraft)
    await ui(
      h.page.getByRole("button", { name: "إتمام البيع", exact: true }),
    ).toBeEnabled();
  await h.page.evaluate(() => document.fonts.ready);
  return h;
}
async function journal(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    workspaceKey(userId),
  );
}
beforeAll(async () => {
  web = await preview({
    root: resolve("apps/web"),
    preview: { host: "127.0.0.1", port: 0, strictPort: true },
  });
  url = `http://127.0.0.1:${(web.httpServer.address() as { port: number }).port}`;
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL ?? "msedge",
    headless: true,
  });
  await mkdir("test-results/pos", { recursive: true });
});
afterAll(async () => {
  for (const context of contexts) await context.close();
  await browser?.close();
  await new Promise<void>((done) => web?.httpServer.close(() => done()));
});
describe("POS desktop and RTL mobile regression", () => {
  it("captures the desktop and 390px RTL layouts", async () => {
    for (const size of [
      { width: 1470, height: 780 },
      { width: 1470, height: 660 },
      { width: 390, height: 844 },
    ]) {
      const { page } = await mount(size);
      expect(await page.locator("html").getAttribute("dir")).toBe("rtl");
      if (size.width > 950) {
        const geometry = await page.evaluate(() => {
          const rect = (selector: string) =>
            document.querySelector(selector)!.getBoundingClientRect();
          return {
            height: innerHeight,
            documentHeight: document.documentElement.scrollHeight,
            checkoutBottom: rect(".pos-checkout").bottom,
            checkoutTop: rect(".pos-checkout").top,
            scrollBottom: rect(".pos-cart-scroll").bottom,
            footerTop: rect(".footer").top,
            gridBottom: rect(".pos-grid").bottom,
          };
        });
        expect(geometry.documentHeight).toBeLessThanOrEqual(size.height + 1);
        expect(geometry.checkoutBottom).toBeLessThanOrEqual(geometry.footerTop);
        expect(
          Math.abs(geometry.gridBottom - geometry.checkoutBottom),
        ).toBeLessThanOrEqual(2);
        expect(geometry.scrollBottom).toBeLessThanOrEqual(
          geometry.checkoutTop + 1,
        );
        await page
          .getByRole("combobox", { name: "رقم العميل أو الاسم" })
          .scrollIntoViewIfNeeded();
        await ui(
          page.getByRole("button", { name: "إتمام البيع", exact: true }),
        ).toBeInViewport();
        await page.locator(".pos-cart-scroll").evaluate((e) => {
          e.scrollTop = 0;
        });
      } else {
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(size.width);
        const geometry = await page.evaluate(() => ({
          checkoutTop: document
            .querySelector(".pos-checkout")!
            .getBoundingClientRect().top,
          contentBottom: document
            .querySelector(".pos-cart-scroll")!
            .getBoundingClientRect().bottom,
        }));
        expect(geometry.checkoutTop).toBeGreaterThanOrEqual(
          geometry.contentBottom - 1,
        );
      }
      const phase = "after";
      await page.screenshot({
        path: `test-results/pos/${phase}-${size.width}x${size.height}.png`,
        fullPage: true,
      });
      if (size.width === 390) {
        await page.locator(".pos-checkout").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `test-results/pos/${phase}-mobile-checkout.png`,
        });
      }
    }
    const { page } = await mount({
      shift: false,
      filled: false,
      customer: false,
    });
    await page.screenshot({
      path: "test-results/pos/after-desktop-no-shift.png",
      fullPage: true,
    });
  });
  it("shows native and server shift validation errors inside the open modal", async () => {
    const h = await mount({
      width: 390,
      height: 844,
      shift: false,
      filled: false,
      customer: false,
    });
    let opens = 0;
    await h.context.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/registers")
        return route.fulfill({
          json: { data: [{ id: shiftId, name: "TEST register" }] },
        });
      if (path === "/api/shifts") return route.fulfill({ json: { data: [] } });
      if (path === "/api/shifts/open") {
        opens++;
        return route.fulfill({
          status: 400,
          json: {
            error: {
              code: "VALIDATION",
              message: "Invalid input",
              fields: {
                fieldErrors: { openingCash: ["Use a positive decimal amount"] },
              },
            },
          },
        });
      }
      return route.fallback();
    });
    await h.page.goto(url + "/shifts");
    await h.page
      .getByRole("button", { name: "فتح وردية", exact: true })
      .click();
    const modal = h.page.getByRole("dialog", {
      name: "فتح وردية",
      exact: true,
    });
    await modal.locator("select[name=registerId]").selectOption(shiftId);
    await modal.locator("input[name=openingCash]").fill("-1");
    await modal.getByRole("button", { name: "حفظ", exact: true }).click();
    await ui(
      modal.getByText("النقد الافتتاحي لا يمكن أن يكون سالبًا.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(opens).toBe(0);
    await modal.locator("input[name=openingCash]").fill("1");
    await modal.getByRole("button", { name: "حفظ", exact: true }).click();
    await ui(
      modal.getByText("تحقق من قيمة النقد الافتتاحي", { exact: false }),
    ).toBeVisible();
    expect(opens).toBe(1);
    await h.page.screenshot({
      path: "test-results/pos/after-shift-validation.png",
    });
  });
  it("shows the 10,000-row export limit and stops incomplete downloads", async () => {
    const h = await mount();
    await h.context.route("**/api/reports/detail/**", (route) =>
      route.fulfill({
        json: { title: "TEST تقرير", data: [], columns: [], total: 10001 },
      }),
    );
    await h.page.goto(url + "/reports");
    await ui(h.page.getByRole("alert")).toContainText("10,000");
    for (const text of ["تصدير Excel", "تصدير PDF"]) {
      const link = h.page.getByText(text, { exact: true });
      await ui(link).toHaveAttribute("aria-disabled", "true");
      expect(await link.getAttribute("href")).toBeNull();
    }
    await h.page.screenshot({
      path: "test-results/pos/after-export-limit.png",
      fullPage: true,
    });
  });
  it("uses the active register location for zero-stock and quantity limits, including barcode scans", async () => {
    const h = await mount();
    const line = h.page.locator(".cart-line-wrapper");
    await ui(
      h.page.locator(".catalog-item").filter({ hasText: soldOut.nameAr }),
    ).toBeDisabled();
    await ui(
      h.page.locator(".catalog-item").filter({ hasText: product.nameAr }),
    ).toContainText("المتاح هنا: 2");
    await h.page
      .getByRole("button", { name: "زيادة الكمية", exact: true })
      .click();
    await ui(
      h.page.getByRole("button", { name: "زيادة الكمية", exact: true }),
    ).toBeDisabled();
    expect((await journal(h.page)).active.items[0].quantity).toBe(2);
    const scanner = h.page.getByLabel("مسح الباركود");
    await scanner.fill("999001");
    await scanner.press("Enter");
    await ui(
      h.page.getByText("المتاح في مكان البيع 2 قطعة.", { exact: false }),
    ).toBeVisible();
    expect((await journal(h.page)).active.items[0].quantity).toBe(2);
    await scanner.fill("999002");
    await scanner.press("Enter");
    await ui(
      h.page.getByText("نفد مخزون هذا الصنف في مكان البيع.", { exact: true }),
    ).toBeVisible();
    expect(await line.count()).toBe(1);
    expect((await journal(h.page)).active.items).toHaveLength(1);
  });
  it("removes an individual line and its discount, and minus at one removes the line", async () => {
    const h = await mount();
    await h.page.getByLabel("خصم POS-UI-2", { exact: true }).fill("10");
    await h.page
      .getByRole("button", { name: "حذف POS-UI-2 من الفاتورة", exact: true })
      .click();
    await ui(h.page.locator(".cart-line-wrapper")).toHaveCount(0);
    expect((await journal(h.page)).active.itemDiscounts).not.toHaveProperty(
      variantId,
    );
    await h.page
      .locator(".catalog-item")
      .filter({ hasText: product.nameAr })
      .click();
    await h.page
      .getByRole("button", { name: "تقليل الكمية", exact: true })
      .click();
    await ui(h.page.locator(".cart-line-wrapper")).toHaveCount(0);
    expect((await journal(h.page)).active.items).toHaveLength(0);
  });
  it("confirms clear in-page without a native dialog, and Escape/cancel keep the draft", async () => {
    for (const width of [1470, 390]) {
      const h = await mount({ width });
      let nativeDialogs = 0;
      h.page.on("dialog", async (dialog) => {
        nativeDialogs++;
        await dialog.dismiss();
      });
      const initial = await journal(h.page);
      const clear = h.page.getByRole("button", { name: "مسح", exact: true });
      await clear.click();
      const modal = h.page.getByRole("dialog", {
        name: "مسح الفاتورة الحالية؟",
        exact: true,
      });
      await ui(modal).toBeVisible();
      expect(
        await modal.evaluate((e) => e.contains(document.activeElement)),
      ).toBe(true);
      await h.page.screenshot({
        path: `test-results/pos/after-clear-${width}.png`,
      });
      await h.page.keyboard.press("Escape");
      await ui(modal).toBeHidden();
      expect(await journal(h.page)).toEqual(initial);
      await clear.click();
      await h.page
        .getByRole("button", { name: "رجوع للفاتورة", exact: true })
        .click();
      expect(await journal(h.page)).toEqual(initial);
      await clear.click();
      await h.page
        .getByRole("button", { name: "تأكيد مسح الفاتورة", exact: true })
        .click();
      await ui(h.page.locator(".cart-line-wrapper")).toHaveCount(0);
      expect((await journal(h.page)).active.customer).toBe("");
      expect(nativeDialogs).toBe(0);
      await ui(h.page.getByLabel("مسح الباركود")).toBeEnabled();
    }
  });
  it("keeps malformed local input editable and never creates a false pending attempt", async () => {
    const h = await mount();
    await h.page.getByLabel("خصم POS-UI-2", { exact: true }).fill("-1");
    await ui(
      h.page.getByRole("button", { name: "إتمام البيع", exact: true }),
    ).toBeDisabled();
    await ui(h.page.locator("#pos-checkout-status")).toContainText(
      "راجع الكميات والخصومات",
    );
    expect((await journal(h.page)).pending).toBeNull();
    await ui(h.page.getByLabel("مسح الباركود")).toBeEnabled();
    await h.page.getByLabel("خصم POS-UI-2", { exact: true }).fill("0");
    await ui(
      h.page.getByRole("button", { name: "إتمام البيع", exact: true }),
    ).toBeEnabled();
    h.rejectQuote = true;
    await h.page
      .getByRole("button", { name: "إتمام البيع", exact: true })
      .click();
    await ui(
      h.page.getByText(
        "الخصم أكبر من القيمة المتاحة أو النسبة أعلى من 100%. راجع الخصم.",
        { exact: true },
      ),
    ).toBeVisible();
    expect((await journal(h.page)).pending).toBeNull();
    expect(h.sales).toHaveLength(0);
    await ui(h.page.getByLabel("مسح الباركود")).toBeEnabled();
  });
  it("shows a reason for missing customer and invalid tender without locking the workspace", async () => {
    const withoutCustomer = await mount({ customer: false });
    await ui(
      withoutCustomer.page.locator("#pos-checkout-status"),
    ).toContainText("اختر العميل");
    await ui(
      withoutCustomer.page.getByRole("button", {
        name: "إتمام البيع",
        exact: true,
      }),
    ).toBeDisabled();
    const invalid = await mount({ invalidDraft: true });
    await ui(invalid.page.locator("#pos-checkout-status")).toContainText(
      "راجع مبالغ الدفع وبيانات البطاقة",
    );
    expect((await journal(invalid.page)).pending).toBeNull();
    await ui(invalid.page.getByLabel("مسح الباركود")).toBeEnabled();
  });
  it("keeps the exact idempotency key and body across an unknown network outcome, reload and retry", async () => {
    const h = await mount();
    h.loseSale = true;
    await h.page
      .getByRole("button", { name: "إتمام البيع", exact: true })
      .click();
    await ui(
      h.page.getByRole("button", {
        name: "إعادة إرسال نفس المحاولة",
        exact: true,
      }),
    ).toBeEnabled();
    const pending = (await journal(h.page)).pending;
    expect(pending).not.toBeNull();
    await h.page.reload();
    await ui(
      h.page.getByRole("button", {
        name: "إعادة إرسال نفس المحاولة",
        exact: true,
      }),
    ).toBeEnabled();
    expect((await journal(h.page)).pending).toEqual(pending);
    await h.page
      .getByRole("button", { name: "إعادة إرسال نفس المحاولة", exact: true })
      .click();
    await ui(
      h.page.getByRole("button", {
        name: "إعادة إرسال نفس المحاولة",
        exact: true,
      }),
    ).toBeEnabled();
    expect(h.sales).toHaveLength(2);
    expect(h.sales[0]).toEqual(h.sales[1]);
    expect(h.sales[0]!.key).toBe(pending.key);
    expect(h.sales[0]!.body).toEqual(pending.body);
  });
  it("explains a stock rejection and only unlocks after confirmed attempt cancellation", async () => {
    const h = await mount();
    await h.page
      .getByRole("button", { name: "إتمام البيع", exact: true })
      .click();
    await ui(
      h.page.getByText("الكمية المطلوبة أكبر من المخزون في مكان البيع.", {
        exact: false,
      }),
    ).toBeVisible();
    expect((await journal(h.page)).pending).not.toBeNull();
    await ui(h.page.getByLabel("مسح الباركود")).toBeDisabled();
    await h.page
      .getByRole("button", { name: "إلغاء المحاولة بأمان", exact: true })
      .click();
    await ui(h.page.getByLabel("مسح الباركود")).toBeEnabled();
    expect((await journal(h.page)).pending).toBeNull();
    expect((await journal(h.page)).active.items).toHaveLength(1);
  });
});
