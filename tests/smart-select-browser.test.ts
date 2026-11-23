import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  chromium,
  expect as ui,
  type Browser,
  type Page,
} from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
const evidenceDir = resolve("test-results/smart-select");
let server: ViteDevServer, browser: Browser, url: string;
const rows = Array.from({ length: 105 }, (_, i) => ({
  id: `employee-${i}`,
  name: i === 0 ? "أحمد محمود" : i === 1 ? "سارة محمد" : `موظف رقم ${i + 1}`,
}));
async function mount(width = 1440) {
  const page = await browser.newPage({
    viewport: { width, height: width < 600 ? 844 : 950 },
  });
  const calls: URL[] = [];
  let fail = false,
    slow = false;
  await page.route("**/api/sales/cashiers**", async (route) => {
    const request = new URL(route.request().url());
    calls.push(request);
    if (slow) await new Promise((done) => setTimeout(done, 650));
    if (fail)
      return route.fulfill({
        status: 500,
        json: { error: { message: "fixture error" } },
      });
    const q = request.searchParams.get("q") ?? "",
      offset = Number(request.searchParams.get("offset") ?? 0);
    const filtered = rows.filter((row) => row.name.includes(q));
    const selected = request.searchParams.get("selected");
    await route.fulfill({
      json: {
        data: filtered.slice(offset, offset + 50),
        hasMore: filtered.length > offset + 50,
        selected:
          selected === "off-page"
            ? { id: selected, name: "موظف خارج الصفحة" }
            : (rows.find((row) => row.id === selected) ?? null),
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url + "/tests/fixtures/smart-select.html");
  await ui(page.getByRole("combobox")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return {
    page,
    calls,
    errors,
    fail: (v: boolean) => {
      fail = v;
    },
    slow: (v: boolean) => {
      slow = v;
    },
  };
}
async function open(page: Page) {
  await page.getByRole("combobox").click();
  await ui(page.getByRole("option").first()).toBeVisible();
}
beforeAll(async () => {
  server = await createServer({
    configFile: resolve("apps/web/vite.config.ts"),
    root: resolve("."),
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  url = `http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}`;
  browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
  });
  await mkdir(evidenceDir, { recursive: true });
});
afterAll(async () => {
  await browser?.close();
  await server?.close();
});
describe("single-control SmartSelect", () => {
  it("captures desktop and phone RTL, closed and expanded without overflow", async () => {
    for (const width of [1440, 390]) {
      const h = await mount(width),
        page = h.page;
      const kind = width === 390 ? "mobile" : "desktop";
      await page.screenshot({
        path: `${evidenceDir}/after-${kind}.png`,
      });
      await open(page);
      await ui(page.getByRole("option")).toHaveCount(50);
      await page.screenshot({
        path: `${evidenceDir}/after-open-${kind}.png`,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const box = await page.locator(".smart-select-popup").boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(h.errors).toEqual([]);
      await page.close();
    }
  });
  it("searches after debounce, selects by keyboard, submits the ID, and keeps the label", async () => {
    const h = await mount(),
      p = h.page,
      input = p.getByRole("combobox");
    await open(p);
    await input.fill("سارة");
    await ui(p.getByRole("option")).toHaveCount(1);
    expect(h.calls.at(-1)!.searchParams.get("q")).toBe("سارة");
    await input.press("ArrowDown");
    await ui(input).toHaveAttribute("aria-activedescendant", /employee-1$/);
    await input.press("Enter");
    await ui(input).toHaveValue("سارة محمد");
    await ui(p.getByRole("listbox")).toHaveCount(0);
    await p.getByRole("button", { name: "متابعة الدفع" }).click();
    await ui(p.getByTestId("submitted")).toHaveText("employee-1");
    await input.click();
    await input.fill("لا يوجد");
    await ui(p.locator(".smart-select-status")).toContainText("لا توجد نتائج");
    expect(await p.locator('select[name="cashierId"]').inputValue()).toBe(
      "employee-1",
    );
    await input.press("Escape");
    await ui(input).toHaveValue("سارة محمد");
    expect(h.errors).toEqual([]);
    await p.close();
  });
  it("pages on the server, resets paging on search, and handles external controlled values", async () => {
    const h = await mount(),
      p = h.page;
    await open(p);
    await p.getByRole("button", { name: "التالي", exact: true }).click();
    await ui(p.locator(".smart-select-status")).toContainText("صفحة 2");
    expect(h.calls.at(-1)!.searchParams.get("offset")).toBe("50");
    await ui(p.getByRole("option")).toHaveCount(50);
    await p.getByRole("combobox").fill("أحمد");
    await ui(p.getByRole("option")).toHaveCount(1);
    expect(h.calls.at(-1)!.searchParams.get("offset")).toBe("0");
    await p.getByRole("option", { name: "أحمد محمود", exact: true }).click();
    await p.getByRole("button", { name: "External value" }).click();
    await ui(p.getByRole("combobox")).toHaveValue("موظف خارج الصفحة");
    await p.getByRole("button", { name: "Reset value" }).click();
    await ui(p.getByRole("combobox")).toHaveValue("");
    expect(h.errors).toEqual([]);
    await p.close();
  });
  it("validates required selection and supports optional clear and disabled forms", async () => {
    const h = await mount(),
      p = h.page;
    await p.getByRole("button", { name: "متابعة الدفع" }).click();
    await ui(p.getByRole("combobox")).toHaveAttribute("aria-invalid", "true");
    await ui(p.getByRole("combobox")).toBeFocused();
    await ui(p.getByTestId("submitted")).toHaveText("");
    await p.getByRole("option", { name: "أحمد محمود", exact: true }).click();
    await p.getByRole("button", { name: "Toggle required" }).click();
    await p
      .getByRole("button", { name: "مسح اسم الكاشير", exact: true })
      .click();
    await ui(p.getByRole("combobox")).toHaveValue("");
    expect(
      await p
        .locator('select[name="cashierId"]')
        .evaluate((el: HTMLSelectElement) => el.checkValidity()),
    ).toBe(true);
    await p.getByRole("button", { name: "Toggle disabled" }).click();
    await ui(p.getByRole("combobox")).toBeDisabled();
    expect(await p.locator('select[name="cashierId"]').isDisabled()).toBe(true);
    expect(h.errors).toEqual([]);
    await p.close();
  });
  it("shows loading, handles error and retry, and closes on outside click and Tab", async () => {
    const h = await mount(),
      p = h.page;
    await open(p);
    h.fail(true);
    await p.getByRole("combobox").fill("خطأ");
    await ui(p.locator(".smart-select-status")).toHaveText(
      "تعذر تحميل الاختيارات.",
    );
    h.fail(false);
    await p.getByRole("button", { name: "إعادة المحاولة" }).click();
    await ui(p.locator(".smart-select-status")).toContainText("لا توجد نتائج");
    h.slow(true);
    await p.getByRole("combobox").fill("سارة");
    await ui(p.locator(".smart-select-status")).toHaveText("جاري البحث...");
    await ui(p.getByRole("option")).toHaveCount(1);
    await p.getByRole("heading").first().click();
    await ui(p.getByRole("listbox")).toHaveCount(0);
    await open(p);
    await ui(p.locator(".smart-select-status")).toContainText("50 نتيجة");
    await p.getByRole("combobox").press("PageDown");
    await ui(p.locator(".smart-select-status")).toContainText("صفحة 2");
    await p.getByRole("combobox").press("PageUp");
    await ui(p.locator(".smart-select-status")).toContainText("صفحة 1");
    await p.getByRole("combobox").press("Tab");
    await ui(p.getByRole("listbox")).toHaveCount(0);
    expect(h.errors).toEqual([]);
    await p.close();
  });
  it("works above a clipped modal, keeps focus and closes Escape before the dialog", async () => {
    const h = await mount(390),
      p = h.page;
    await p.getByRole("button", { name: "Open modal" }).click();
    const dialog = p.getByRole("dialog"),
      input = dialog.getByRole("combobox");
    await input.click();
    await ui(dialog.getByRole("option").first()).toBeVisible();
    const option = dialog.getByRole("option").first();
    const box = await option.boundingBox();
    expect(
      await p.evaluate(
        ({ x, y }) =>
          document.elementFromPoint(x, y)?.closest('[role="option"]') !== null,
        { x: box!.x + 10, y: box!.y + 10 },
      ),
    ).toBe(true);
    await input.press("ArrowUp");
    await ui(input).toHaveAttribute("aria-activedescendant", /employee-49$/);
    await input.press("Escape");
    await ui(dialog).toBeVisible();
    await input.click();
    await dialog
      .getByRole("option", { name: "سارة محمد", exact: true })
      .click();
    await ui(input).toHaveValue("سارة محمد");
    await input.click();
    await p.screenshot({
      path: `${evidenceDir}/after-modal-mobile.png`,
    });
    expect(h.errors).toEqual([]);
    await p.close();
  });
  it("clears custom validity after selection, as required by the application invalid handler", async () => {
    const h = await mount(),
      p = h.page;
    await p.evaluate(() =>
      document.addEventListener(
        "invalid",
        (e) => (e.target as HTMLSelectElement).setCustomValidity("اختر قيمة"),
        true,
      ),
    );
    await p.getByRole("button", { name: "متابعة الدفع" }).click();
    await p.getByRole("option", { name: "سارة محمد", exact: true }).click();
    await p.getByRole("button", { name: "متابعة الدفع" }).click();
    await ui(p.getByTestId("submitted")).toHaveText("employee-1");
    await p.close();
  });
});
