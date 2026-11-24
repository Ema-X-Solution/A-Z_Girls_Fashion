import { beforeAll, afterAll, it, expect } from "vitest";
import { chromium, expect as ui, type Browser } from "@playwright/test";
import { pickSmartOption } from "./smart-select";
import { preview, type PreviewServer } from "vite";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";

let browser: Browser, web: PreviewServer, url: string;

const suppliers = [
  { id: "sup-1", name: "مورد الأقمشة", code: "SUP-0001" },
  { id: "sup-2", name: "مورد الجملة", code: "SUP-0002" },
];
const locations = [
  { id: "loc-1", name: "المخزن الرئيسي" },
  { id: "loc-2", name: "مخزن الفرع" },
];
const mk = (id: string, nameAr: string, sku: string, supplierId: string | null, quantities: number[], minStock = 2, locationId = "loc-1") => ({
  id,
  nameAr,
  sku,
  primarySupplierId: supplierId,
  status: "ACTIVE",
  category: { name: "ملابس" },
  imageUrl: null,
  variants: quantities.map((quantity, i) => ({
    id: `${id}-v${i}`,
    sku: `${sku}-V${i}`,
    barcode: `2012345678${id.slice(-1)}${i}`,
    price: "350",
    options: {},
    minStock,
    balances: [{ quantity, locationId }],
  })),
});
const products = [
  mk("prod-1", "فستان بناتي وردي", "PRD-1001", "sup-1", [10]),
  mk("prod-2", "بلوزة قطن مطبوعة", "PRD-1002", "sup-1", [1]),
  mk("prod-3", "تنورة جينز", "PRD-1003", "sup-2", [0], 2, "loc-2"),
  mk("prod-4", "طقم بناتي صيفي", "PRD-1004", null, [0, 6]),
];
const totals = (p: any) => {
  const qty = p.variants.reduce((s: number, v: any) => s + v.balances.reduce((n: number, b: any) => n + b.quantity, 0), 0);
  const low = p.variants.some((v: any) => v.balances.reduce((n: number, b: any) => n + b.quantity, 0) <= v.minStock);
  return { qty, low };
};
const filtered = (params: URLSearchParams) => {
  const supplierId = params.get("supplierId"), stock = params.get("stock"), locationId = params.get("locationId");
  return products.filter((p) => {
    if (supplierId && p.primarySupplierId !== supplierId) return false;
    if (locationId && !p.variants.some((v: any) => v.balances.some((b: any) => b.locationId === locationId))) return false;
    if (!stock) return true;
    const { qty, low } = totals(p);
    return stock === "out" ? qty <= 0 : stock === "low" ? qty > 0 && low : qty > 0 && !low;
  });
};

const productsCalls: { url: string; total: number }[] = [];
beforeAll(async () => {
  web = await preview({ root: resolve("apps/web"), preview: { host: "127.0.0.1", port: 0 } });
  url = `http://127.0.0.1:${(web.httpServer.address() as { port: number }).port}`;
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE ?? "/usr/bin/google-chrome", headless: true });
  await mkdir("test-results/products-filters", { recursive: true });
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => web?.httpServer.close(() => done()));
});

async function openProducts(width: number, theme: "light" | "dark") {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.setDefaultTimeout(5000);
  await page.addInitScript((t) => window.localStorage.setItem("az-theme", t), theme);
  await page.route("**/api/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname;
    if (path === "/api/auth/me")
      return route.fulfill({
        json: {
          data: {
            id: "owner",
            name: "مدير تجريبي",
            roles: ["OWNER"],
            permissions: ["products.view", "products.create", "products.update", "products.archive", "suppliers.view"],
            csrf: "test",
          },
        },
      });
    if (path === "/api/branding" || path === "/api/public/store") return route.fulfill({ json: { data: { name: "A&Z Girls Fashion" } } });
    if (path === "/api/options/locations") {
      const q = requestUrl.searchParams.get("q") ?? "";
      const selectedId = requestUrl.searchParams.get("selected") ?? "";
      return route.fulfill({
        json: {
          data: locations.filter((l) => l.name.includes(q)),
          hasMore: false,
          selected: locations.find((l) => l.id === selectedId) ?? null,
        },
      });
    }
    if (path === "/api/options/suppliers") {
      const q = requestUrl.searchParams.get("q") ?? "";
      const selectedId = requestUrl.searchParams.get("selected") ?? "";
      return route.fulfill({
        json: {
          data: suppliers.filter((s) => s.name.includes(q) || s.code.includes(q)),
          hasMore: false,
          selected: suppliers.find((s) => s.id === selectedId) ?? null,
        },
      });
    }
    if (path === "/api/products") {
      if (requestUrl.searchParams.get("countOnly")) return route.fulfill({ json: { total: 0 } });
      const rows = filtered(requestUrl.searchParams);
      productsCalls.push({ url: requestUrl.search, total: rows.length });
      return route.fulfill({ json: { data: rows, total: rows.length } });
    }
    return route.fulfill({ json: { data: [] } });
  });
  await page.goto(`${url}/products`);
  await ui(page.getByRole("columnheader", { name: "المنتج", exact: true })).toBeVisible();
  return page;
}

it.each([
  [1440, "light"],
  [1440, "dark"],
  [390, "light"],
  [390, "dark"],
] as const)("products toolbar shows supplier and stock filters at %spx %s", async (width, theme) => {
  const page = await openProducts(width, theme);
  const mobile = width <= 920;
  const toggle = page.getByRole("button", { name: /الفلاتر/ });
  try {
    if (mobile) {
      // Collapsed by default: toggle visible, filters hidden, no active count.
      await ui(toggle).toBeVisible();
      await ui(toggle.locator(".tab-count")).toHaveCount(0);
      await ui(page.getByRole("combobox", { name: "المورد", exact: true })).toBeHidden();
      await page.screenshot({ path: `test-results/products-filters/products-${width}-${theme}-collapsed.png` });
      await toggle.click();
      await ui(toggle).toHaveAttribute("aria-expanded", "true");
    } else {
      await ui(toggle).toBeHidden();
    }
    await ui(page.getByRole("combobox", { name: "المورد", exact: true })).toBeVisible();
    await ui(page.getByRole("combobox", { name: "المخزن", exact: true })).toBeVisible();
    await ui(page.getByLabel("حالة المخزون", { exact: true })).toBeVisible();
    const activeTab = page.getByRole("button", { name: /المنتجات الحالية/ });
    await ui(activeTab.locator(".tab-count")).toHaveText("4");
    await ui(page.locator(".toolbar .muted-text")).toHaveCount(0);
    await page.screenshot({ path: `test-results/products-filters/products-${width}-${theme}.png` });
  } finally {
    await page.close();
  }
});

it.each([1440, 390])("supplier and stock filters drive the products query at %spx", async (width) => {
  const page = await openProducts(width, "light");
  const toggle = page.getByRole("button", { name: /الفلاتر/ });
  try {
    if (width <= 920) await toggle.click();
    // Each assertion waits for the visible count, then checks the API call
    // whose response carries that count (React Query isolates stale keys).
    const lastCallWith = (total: number) =>
      productsCalls.filter((call) => call.total === total).at(-1);
    const badge = page
      .getByRole("button", { name: /المنتجات الحالية/ })
      .locator(".tab-count");
    await pickSmartOption(page, "المورد", "مورد الأقمشة");
    await ui(badge).toHaveText("2");
    if (width <= 920) await ui(toggle.locator(".tab-count")).toHaveText("1");
    expect(lastCallWith(2)?.url).toContain("supplierId=sup-1");
    expect(lastCallWith(2)?.url).not.toContain("stock=");
    await page.getByLabel("حالة المخزون", { exact: true }).selectOption("low");
    await ui(badge).toHaveText("1");
    expect(lastCallWith(1)?.url).toContain("supplierId=sup-1");
    expect(lastCallWith(1)?.url).toContain("stock=low");
    await ui(page.getByText("بلوزة قطن مطبوعة", { exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/products-filters/products-${width}-filtered.png` });
    await page.getByRole("button", { name: "مسح المورد", exact: true }).click();
    await ui(badge).toHaveText("2");
    expect(lastCallWith(2)?.url).not.toContain("supplierId=");
    expect(lastCallWith(2)?.url).toContain("stock=low");
    await page.getByLabel("حالة المخزون", { exact: true }).selectOption("out");
    await ui(badge).toHaveText("1");
    expect(lastCallWith(1)?.url).toContain("stock=out");
    await ui(page.getByText("تنورة جينز", { exact: true })).toBeVisible();
    await page.getByLabel("حالة المخزون", { exact: true }).selectOption("");
    await ui(badge).toHaveText("4");
    expect(lastCallWith(4)?.url).not.toContain("stock=");
    expect(lastCallWith(4)?.url).not.toContain("supplierId=");
    // Warehouse filter: loc-2 holds only تنورة جينز, at zero quantity (kept by design).
    await pickSmartOption(page, "المخزن", "مخزن الفرع");
    await ui(badge).toHaveText("1");
    expect(lastCallWith(1)?.url).toContain("locationId=loc-2");
    await ui(page.getByText("تنورة جينز", { exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/products-filters/products-${width}-warehouse.png` });
  } finally {
    await page.close();
  }
});
