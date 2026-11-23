import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  chromium,
  expect as ui,
  type Browser,
  type BrowserContext,
} from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
let browser: Browser;
let web: PreviewServer;
let url: string;
const settings = {
  name: "TEST Store",
  currency: "EGP",
  timezone: "Africa/Cairo",
  address: "TEST address",
  phone: "01000000000",
  taxRate: "14",
  taxMode: "INCLUSIVE",
  returnDays: 14,
  receiptWidth: 80,
  receiptFooter: "TEST footer",
  returnPolicy: "TEST return policy unchanged",
  branchName: "TEST Branch",
  invoicePrefix: "INV",
  taxNumber: "TEST-TAX",
  commercialRegister: "TEST-REG",
};
const sale = {
  id: "11111111-1111-4111-8111-111111111111",
  number: 1,
  receiptNumber: "INV-2026-00001",
  createdAt: "2026-11-22T16:00:00Z",
  status: "COMPLETED",
  subtotal: "120",
  discount: "12",
  netBeforeTax: "94.74",
  tax: "13.26",
  taxRate: "14",
  taxMode: "INCLUSIVE",
  total: "108",
  change: "2",
  user: { name: "TEST Cashier" },
  receiptSnapshot: {
    ...settings,
    cashierName: "TEST Cashier",
    sellerCode: "TEST-001",
    registerName: "TEST POS",
  },
  items: [
    {
      id: "test-item",
      name: "TEST Dress",
      barcode: "1234567890123",
      sku: "TEST-001",
      quantity: 1,
      price: "120",
      unitPrice: "120",
      discount: "12",
      total: "108",
      options: { Size: "M" },
    },
  ],
  payments: [{ id: "test-payment", method: "CASH", amount: "108" }],
};
beforeAll(async () => {
  web = await preview({
    root: resolve("apps/web"),
    preview: { host: "127.0.0.1", port: 0 },
  });
  url = `http://127.0.0.1:${(web.httpServer.address() as { port: number }).port}`;
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL ?? "msedge",
    headless: true,
  });
  await mkdir("test-results/invoice-tax", { recursive: true });
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => web?.httpServer.close(() => done()));
});
async function mock(
  context: BrowserContext,
  initial?: boolean,
  storeGate?: Promise<void>,
) {
  let store: Record<string, unknown> = {
    ...settings,
    ...(initial === undefined ? {} : { showTaxOnInvoice: initial }),
  };
  const saved: Record<string, unknown>[] = [];
  await context.route("**/api/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    let data: unknown = [];
    if (path === "/api/auth/me")
      data = {
        id: "test-owner",
        name: "TEST Owner",
        roles: ["OWNER"],
        permissions: ["settings.manage", "sales.view_own", "dashboard.view"],
        csrf: "test-csrf",
      };
    else if (path === "/api/store") {
      await storeGate;
      data = store;
    } else if (path === "/api/settings/store" && req.method() === "PATCH") {
      const body = req.postDataJSON();
      saved.push(body);
      store = { ...store, ...body };
      data = store;
    } else if (["/api/branding", "/api/public/store"].includes(path))
      data = { name: "TEST Store" };
    else if (path === "/api/loyalty/settings")
      data = {
        enabled: false,
        spendPerPoint: "100",
        pointValue: "1",
        expiryDays: 365,
        maxRedeemPercent: "20",
        minimumRedeemPoints: 1,
      };
    else if (path === "/api/sales") data = [sale];
    else if (path === "/api/shifts/current") data = null;
    await route.fulfill({ json: { data, pagination: { total: 1 } } });
  });
  return saved;
}

describe("invoice tax toggle in the built UI", () => {
  it.each([1440, 390])(
    "saves the toggle and hides only two rows in preview and print at %spx",
    async (width) => {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
      });
      try {
        const saved = await mock(context);
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(`${url}/settings`);
        const toggle = page.getByRole("switch", {
          name: "إظهار الضريبة في الفاتورة",
          exact: true,
        });
        await ui(toggle).toBeChecked();
        await toggle.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `test-results/invoice-tax/settings-on-${width}.png`,
        });
        const form = page.locator("form").filter({ has: toggle });
        await toggle.uncheck();
        await form.getByRole("button", { name: "حفظ", exact: true }).click();
        await ui(toggle).not.toBeChecked();
        await ui.poll(() => saved.length).toBe(1);
        expect(saved[0].showTaxOnInvoice).toBe(false);
        expect(saved[0].taxRate).toBe("14");
        expect(saved[0].taxMode).toBe("INCLUSIVE");
        await page.reload();
        await ui(toggle).not.toBeChecked();
        await toggle.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `test-results/invoice-tax/settings-off-${width}.png`,
        });
        await page.goto(`${url}/sales`);
        await page
          .getByRole("button", { name: "عرض الفاتورة", exact: true })
          .click();
        const receipt = page.locator(".receipt-preview");
        await ui(receipt).toBeVisible();
        await ui(
          receipt.getByText("Net before VAT", { exact: true }),
        ).toHaveCount(0);
        await ui(receipt.getByText(/^VAT/)).toHaveCount(0);
        const otherRows = await receipt
          .locator(".receipt-summary-row")
          .allInnerTexts();
        const policy = await receipt
          .locator(".fashion-return-policy")
          .innerText();
        const footer = await receipt
          .locator(".fashion-receipt-footer")
          .innerText();
        await ui(receipt).toContainText("108.00 EGP");
        await ui(receipt).toContainText("-12.00 EGP");
        await receipt.screenshot({
          path: `test-results/invoice-tax/receipt-off-${width}.png`,
        });
        await page.emulateMedia({ media: "print" });
        const print = page.locator("#az-receipt-print-root article");
        await ui(print).toBeVisible();
        await ui(
          print.getByText("Net before VAT", { exact: true }),
        ).toHaveCount(0);
        await ui(print.getByText(/^VAT/)).toHaveCount(0);
        expect(
          await print.locator(".receipt-summary-row").allInnerTexts(),
        ).toEqual(otherRows);
        await print.screenshot({
          path: `test-results/invoice-tax/print-off-${width}.png`,
        });
        await page.emulateMedia({ media: "screen" });
        await page.goto(`${url}/settings`);
        await toggle.check();
        await form.getByRole("button", { name: "حفظ", exact: true }).click();
        await ui.poll(() => saved.length).toBe(2);
        expect(saved[1].showTaxOnInvoice).toBe(true);
        await page.goto(`${url}/sales`);
        await page
          .getByRole("button", { name: "عرض الفاتورة", exact: true })
          .click();
        await ui(
          receipt.getByText("Net before VAT", { exact: true }),
        ).toBeVisible();
        await ui(receipt.getByText(/^VAT \(14% included\)$/)).toBeVisible();
        await ui(receipt).toContainText("94.74 EGP");
        await ui(receipt).toContainText("13.26 EGP");
        const unchanged = (
          await receipt.locator(".receipt-summary-row").allInnerTexts()
        ).filter(
          (s) => !s.startsWith("Net before VAT") && !s.startsWith("VAT"),
        );
        expect(unchanged).toEqual(otherRows);
        expect(
          await receipt.locator(".fashion-return-policy").innerText(),
        ).toBe(policy);
        expect(
          await receipt.locator(".fashion-receipt-footer").innerText(),
        ).toBe(footer);
        await receipt.screenshot({
          path: `test-results/invoice-tax/receipt-on-${width}.png`,
        });
        await page.emulateMedia({ media: "print" });
        await ui(
          print.getByText("Net before VAT", { exact: true }),
        ).toBeVisible();
        await ui(print.getByText(/^VAT/)).toBeVisible();
        await print.screenshot({
          path: `test-results/invoice-tax/print-on-${width}.png`,
        });
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    },
    60000,
  );
  it("keeps old settings default ON and waits for settings before auto-print", async () => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    try {
      let release!: () => void;
      const gate = new Promise<void>((done) => {
        release = done;
      });
      await mock(context, undefined, gate);
      await context.addInitScript(() => {
        (window as any).printCalls = 0;
        window.print = () => {
          (window as any).printCalls++;
        };
      });
      const page = await context.newPage();
      await page.goto(`${url}/sales`);
      await page
        .getByRole("button", { name: "طباعة الفاتورة", exact: true })
        .click();
      await ui(page.locator(".receipt-skeleton")).toBeVisible();
      expect(await page.evaluate(() => (window as any).printCalls)).toBe(0);
      expect(await page.locator("#az-receipt-print-root").count()).toBe(0);
      release();
      await ui(
        page
          .locator(".receipt-preview")
          .getByText("Net before VAT", { exact: true }),
      ).toBeVisible();
      await ui
        .poll(() => page.evaluate(() => (window as any).printCalls))
        .toBe(1);
    } finally {
      await context.close();
    }
  });
});
