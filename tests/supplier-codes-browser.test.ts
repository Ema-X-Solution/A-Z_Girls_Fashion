import { beforeAll, afterAll, it, expect } from "vitest";
import { chromium, expect as ui, type Browser } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
let browser: Browser, web: PreviewServer, url: string;
beforeAll(async () => {
  web = await preview({ root: resolve("apps/web"), preview: { host: "127.0.0.1", port: 0 } });
  url = `http://127.0.0.1:${(web.httpServer.address() as { port: number }).port}`;
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE ?? "/usr/bin/google-chrome", headless: true });
  await mkdir("test-results/supplier-codes", { recursive: true });
});
afterAll(async () => { await browser?.close(); await new Promise<void>((done) => web?.httpServer.close(() => done())); });
it("shows generated supplier identities and supports editing, with no code entry on create", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const supplier = { id: "11111111-1111-4111-8111-111111111111", name: "مورد تجريبي", code: "SUP-0001", phone: "", address: "", notes: "", currentBalance: "0" };
  let update: any;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: any = [];
    if (path === "/api/auth/me") data = { id: "owner", name: "مدير تجريبي", roles: ["OWNER"], permissions: ["suppliers.view", "suppliers.manage"], csrf: "test" };
    else if (path === "/api/branding" || path === "/api/public/store") data = { name: "A&Z Girls Fashion" };
    else if (path === "/api/suppliers") { await route.fulfill({ json: { data: [supplier], total: 1 } }); return; }
    else if (path === `/api/suppliers/${supplier.id}`) { update = route.request().postDataJSON(); data = { ...supplier, ...update }; }
    await route.fulfill({ json: { data } });
  });
  try {
    await page.goto(`${url}/suppliers`);
    await ui(page.getByText("SUP-0001", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "إضافة مورد", exact: true }).click();
    await ui(page.getByText("كود المورد بيتولد تلقائيًا عند الحفظ.", { exact: true })).toBeVisible();
    expect(await page.locator('input[name="code"]').count()).toBe(0);
    await page.getByRole("button", { name: "إلغاء", exact: true }).click();
    await page.getByRole("button", { name: "تعديل البيانات", exact: true }).click();
    await ui(page.getByLabel("كود المورد", { exact: true })).toHaveValue("SUP-0001");
    await page.screenshot({ path: "test-results/supplier-codes/edit-supplier.png" });
    await page.getByLabel("كود المورد", { exact: true }).fill("CUSTOM-01");
    await page.getByRole("button", { name: "حفظ التعديلات", exact: true }).click();
    await ui(page.getByLabel("كود المورد", { exact: true })).toHaveCount(0);
    expect(update.code).toBe("CUSTOM-01");
  } finally { await page.close(); }
});
