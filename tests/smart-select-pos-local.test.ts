import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
const evidenceDir = resolve("test-results/smart-select");
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
  draft.active.cashierId = userId;
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
        roles: ["SELLER"],
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
    else if (path === "/sales/cashiers")
      data = [
        { id: userId, name: "أحمد محمود" },
        { id: "99999999-9999-4999-8999-999999999999", name: "سارة محمد" },
      ];
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
    await route.fulfill({
      status: 200,
      json:
        path === "/sales/cashiers"
          ? {
              data,
              hasMore: false,
              selected: { id: userId, name: "أحمد محمود" },
            }
          : path === "/products"
            ? { data, total: 2, page: 1, pageSize: 25 }
            : { data },
    });
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
  await mkdir(evidenceDir, { recursive: true });
});
afterEach(async () => {
  for (const context of contexts.splice(0)) await context.close();
});
afterAll(async () => {
  for (const context of contexts) await context.close();
  await browser?.close();
  await new Promise<void>((done) => web?.httpServer.close(() => done()));
});
describe("SmartSelect inside the real POS page", () => {
  it("captures desktop and phone without clipping and selects a cashier", async () => {
    for (const size of [
      { width: 1470, height: 780 },
      { width: 1470, height: 660 },
      { width: 390, height: 844 },
    ]) {
      const { page } = await mount({ ...size, filled: false, customer: false });
      const input = page.getByRole("combobox", {
        name: "اسم الكاشير",
        exact: true,
      });
      await input.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${evidenceDir}/pos-after-${size.width}-${size.height}.png`,
      });
      await input.click();
      await ui(
        page.getByRole("option", { name: "سارة محمد", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: `${evidenceDir}/pos-after-open-${size.width}-${size.height}.png`,
      });
      await page
        .getByRole("option", { name: "سارة محمد", exact: true })
        .click();
      await ui(input).toHaveValue("سارة محمد");
      expect((await journal(page)).active.cashierId).toBe(
        "99999999-9999-4999-8999-999999999999",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await ui(
        page.getByRole("button", { name: "إتمام البيع", exact: true }),
      ).toBeDisabled();
    }
  });
});
