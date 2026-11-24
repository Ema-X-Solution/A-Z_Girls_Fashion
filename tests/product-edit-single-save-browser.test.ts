import { beforeAll, afterAll, it, expect } from "vitest";
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
    executablePath: process.env.BROWSER_EXECUTABLE ?? "/usr/bin/google-chrome",
    headless: true,
  });
  await mkdir("test-results/product-edit", { recursive: true });
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((done) => web?.httpServer.close(() => done()));
});

it("product edit modal: one save button for info and optional variant change", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(4000);
  const product = {
    id: "p1",
    nameAr: "فستان بناتي",
    sku: "PRD-1",
    primarySupplierId: "",
    description: "وصف قديم",
    returnRule: "STANDARD",
    status: "ACTIVE",
    imageUrl: null,
    variants: [
      { id: "v1", sku: "VAR-1", barcode: "201234567891", price: "100", options: { المقاس: "4" }, balances: [], minStock: 2 },
      { id: "v2", sku: "VAR-2", barcode: "201234567892", price: "120", options: { المقاس: "6" }, balances: [], minStock: 3 },
    ],
  };
  const calls: { path: string; method: string; body: any }[] = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    let data: any = [];
    if (path === "/api/auth/me")
      data = {
        id: "owner",
        name: "مدير تجريبي",
        roles: ["OWNER"],
        permissions: ["products.view", "products.update", "products.change_price"],
        csrf: "test",
      };
    else if (path === "/api/branding" || path === "/api/public/store")
      data = { name: "A&Z Girls Fashion" };
    else if (path.startsWith("/api/options/")) {
      await route.fulfill({ json: { data: [], hasMore: false } });
      return;
    } else if (path === "/api/products") {
      await route.fulfill({ json: { data: [product], total: 1 } });
      return;
    } else if (path === "/api/products/p1" || path.startsWith("/api/variants/")) {
      calls.push({ path, method: req.method(), body: req.postDataJSON() });
      data = { ...product };
    }
    await route.fulfill({ json: { data } });
  });
  try {
    await page.goto(`${url}/products`);
    await page.getByRole("button", { name: "التفاصيل", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await ui(dialog.locator("button.form-submit")).toHaveCount(1);

    // info-only save hits only the product endpoint and never sends variant keys
    await dialog.locator('textarea[name="description"]').fill("وصف جديد");
    await dialog.locator("button.form-submit").click();
    await ui(dialog).toHaveCount(0);
    expect(calls.length).toBe(1);
    expect(calls[0].path).toBe("/api/products/p1");
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].body.description).toBe("وصف جديد");
    expect(calls[0].body.variantId).toBeUndefined();
    expect(calls[0].body.price).toBeUndefined();
    expect(calls[0].body.minStock).toBeUndefined();

    // a price without a chosen variant is blocked inline; nothing is sent
    await page.getByRole("button", { name: "التفاصيل", exact: true }).click();
    await dialog.locator('input[name="price"]').fill("150");
    await dialog.locator("button.form-submit").click();
    await ui(dialog.locator(".form-error")).toBeVisible();
    expect(calls.length).toBe(1);

    // choosing the variant then saving sends product patch then variant patch
    await dialog.locator('select[name="variantId"]').selectOption("v2");
    await dialog.locator("button.form-submit").click();
    await ui(dialog).toHaveCount(0);
    expect(calls.length).toBe(3);
    expect(calls[1].path).toBe("/api/products/p1");
    expect(calls[2].path).toBe("/api/variants/v2");
    expect(calls[2].method).toBe("PATCH");
    expect(String(calls[2].body.price)).toBe("150");
  } finally {
    await page.close();
  }
});
