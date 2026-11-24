import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, expect as ui, type Browser } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { resolve } from "node:path";
let browser: Browser;
let web: PreviewServer;
let url: string;

const columns = [
  { key: "label", label: "البيان" },
  { key: "quantity", label: "صافي القطع" },
  { key: "net", label: "الصافي قبل الضريبة" },
  { key: "tax", label: "الضريبة" },
  { key: "total", label: "شامل الضريبة" },
  { key: "cost", label: "تكلفة المباع" },
  { key: "profit", label: "مجمل الربح" },
];
const rows = [
  {
    label: "2026-11-24",
    quantity: "38",
    net: "15230.50",
    tax: "2132.27",
    total: "17362.77",
    cost: "9800.00",
    profit: "5430.50",
  },
  {
    label: "2026-11-23",
    quantity: "51",
    net: "21940.00",
    tax: "3071.60",
    total: "25011.60",
    cost: "14320.00",
    profit: "7620.00",
  },
];

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
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => web?.httpServer.close(() => done()));
});

async function openReports(width: number) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/api/**", async (route) => {
    const request = new URL(route.request().url());
    if (request.pathname === "/api/auth/me")
      return route.fulfill({
        json: {
          data: {
            id: "11111111-1111-4111-8111-111111111111",
            name: "TEST Owner",
            email: "owner@example.test",
            roles: ["OWNER"],
            permissions: [
              "dashboard.view",
              "pos.access",
              "reports.sales",
              "reports.profit",
            ],
            csrf: "fixture-csrf",
            discountLimit: "0",
          },
        },
      });
    if (["/api/store", "/api/public/store", "/api/branding"].includes(request.pathname))
      return route.fulfill({
        json: {
          data: { name: "A&Z Girls Fashion", taxRate: "0", taxMode: "EXCLUSIVE" },
        },
      });
    if (request.pathname === "/api/reports/detail/daily")
      return route.fulfill({
        json: {
          title: "المبيعات اليومية",
          total: rows.length,
          columns,
          data: rows,
        },
      });
    return route.fulfill({ json: { data: [] } });
  });
  await page.goto(`${url}/reports`);
  await page.waitForSelector(".management-table tbody tr");
  return { context, page, errors };
}

describe("daily sales report on mobile", () => {
  it("renders each day as a labeled card at 390px with no horizontal scroll", async () => {
    const { context, page, errors } = await openReports(390);
    try {
      const cards = page.locator(".report-daily-cards tbody tr");
      await ui(cards).toHaveCount(rows.length);
      // The day is the card title and carries no ::before label.
      await ui(cards.first().locator("td").first()).toHaveText("2026-11-24");
      const geometry = await page.evaluate(() => {
        const table = document.querySelector(".report-daily-cards table")!;
        const head = document.querySelector(".report-daily-cards thead")!;
        const firstCard = document.querySelector(
          ".report-daily-cards tbody tr",
        )!;
        const title = firstCard.querySelector("td")!;
        const value = firstCard.querySelectorAll("td")[4]!;
        const before = getComputedStyle(value, "::before");
        return {
          headDisplay: getComputedStyle(head).display,
          cardDisplay: getComputedStyle(firstCard).display,
          cardBorderRadius: getComputedStyle(firstCard).borderRadius,
          titleBefore: getComputedStyle(title, "::before").content,
          valueBefore: before.content,
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          tableWidth: table.getBoundingClientRect().width,
        };
      });
      expect(geometry.headDisplay).toBe("none");
      expect(geometry.cardDisplay).toBe("block");
      expect(geometry.cardBorderRadius).toBe("10px");
      expect(geometry.titleBefore).toBe("none");
      expect(geometry.valueBefore).toBe('"شامل الضريبة"');
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.innerWidth);
      // Every column value is visible inside the card, including profit ones.
      const text = await cards.first().innerText();
      for (const value of Object.values(rows[0]!)) {
        expect(text).toContain(value);
      }
      // Labels come from the column definitions via data-label.
      const labels = await cards
        .first()
        .locator("td")
        .evaluateAll((cells) =>
          cells.map((cell) => cell.getAttribute("data-label")),
        );
      expect(labels).toEqual(columns.map((column) => column.label));
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it("stacks the filter area tidily at 390px with the print button fully visible", async () => {
    const { context, page, errors } = await openReports(390);
    try {
      const boxes = await page.evaluate(() => {
        const rect = (el: Element) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width };
        };
        const fields = [
          ...document.querySelectorAll(
            ".report-controls.management-tools .management-field",
          ),
        ].map((el) => rect(el));
        const search = rect(
          document.querySelector(".report-controls.management-tools > .search")!,
        );
        const buttons = [
          ...document.querySelectorAll(".report-controls.inline-actions .btn"),
        ].map((el) => rect(el));
        return { fields, search, buttons, innerWidth: window.innerWidth };
      });
      // Report type and search span the full width; the dates share one row.
      const [type, from, to] = boxes.fields;
      expect(type!.width).toBeGreaterThan(boxes.innerWidth * 0.7);
      expect(boxes.search.width).toBeGreaterThan(boxes.innerWidth * 0.7);
      expect(boxes.search.y).toBeGreaterThan(from!.y);
      expect(from!.y).toBe(to!.y);
      expect(from!.width).toBeLessThan(boxes.innerWidth * 0.6);
      expect(from!.y).toBeGreaterThan(type!.y);
      // Excel and PDF share a row; print sits on its own full-width row,
      // completely inside the viewport.
      const [excel, pdf, print] = boxes.buttons;
      expect(excel!.y).toBe(pdf!.y);
      expect(print!.y).toBeGreaterThan(excel!.y);
      expect(print!.width).toBeGreaterThan(boxes.innerWidth * 0.7);
      expect(print!.x).toBeGreaterThanOrEqual(0);
      expect(print!.x + print!.width).toBeLessThanOrEqual(boxes.innerWidth);
      // The search field has no visible label: icon + placeholder + aria-label.
      const searchBox = page.locator(
        ".report-controls.management-tools > .search",
      );
      await ui(searchBox.locator("svg")).toHaveCount(1);
      await ui(searchBox.locator("input")).toHaveAttribute(
        "aria-label",
        "بحث داخل التقرير",
      );
      await ui(searchBox.locator("input")).toHaveAttribute(
        "placeholder",
        "بحث داخل التقرير",
      );
      await ui(
        page.locator(".report-controls.management-tools label", {
          hasText: "بحث داخل التقرير",
        }),
      ).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it("keeps the regular table on desktop", async () => {
    const { context, page, errors } = await openReports(1440);
    try {
      await ui(
        page.locator(".report-daily-cards thead th"),
      ).toHaveCount(columns.length);
      const display = await page.evaluate(() => {
        const head = document.querySelector(".report-daily-cards thead")!;
        const row = document.querySelector(".report-daily-cards tbody tr")!;
        return {
          head: getComputedStyle(head).display,
          row: getComputedStyle(row).display,
        };
      });
      expect(display.head).toBe("table-header-group");
      expect(display.row).toBe("table-row");
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
