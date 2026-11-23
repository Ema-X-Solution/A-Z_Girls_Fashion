import { seedPaginationLists } from "./pagination-fixtures";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { chromium, expect as ui, type Browser } from "@playwright/test";
import { preview, type PreviewServer } from "vite";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Server } from "node:http";
import type { PrismaClient } from "@prisma/client";
let pg: EmbeddedPostgres,
  db: PrismaClient,
  browser: Browser,
  web: PreviewServer,
  api: Server;
let pgPort: number;
const password = randomBytes(24).toString("hex");

beforeAll(async () => {
  await mkdir(".test-data", { recursive: true });
  const { createServer: socketServer } = await import("node:net");
  pgPort = await new Promise<number>((done) => {
    const server = socketServer();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => done(port));
    });
  });
  pg = new EmbeddedPostgres({
    databaseDir: await mkdtemp(resolve(".test-data/pagination-")),
    user: "az_test",
    password,
    port: pgPort,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-h", "127.0.0.1"],
    onLog: () => {},
    onError: (e) => console.error(e),
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("az_search");
  process.env.DATABASE_URL = `postgresql://az_test:${password}@127.0.0.1:${pgPort}/az_search`;
  process.env.APP_ORIGIN = "http://127.0.0.1:5173";
  process.env.NODE_ENV = "test";
  execFileSync(
    process.execPath,
    [
      "node_modules/prisma/build/index.js",
      "migrate",
      "deploy",
      "--schema",
      "apps/api/prisma/schema.prisma",
    ],
    { env: process.env, stdio: "pipe" },
  );
  const { PrismaClient: Client } = await import("@prisma/client");
  db = new Client();
  const { hash } = await import("argon2");
  const { permissions } = await import("@az/shared");
  await db.permission.createMany({
    data: permissions.map((key) => ({ key })),
    skipDuplicates: true,
  });
  const role = await db.role.create({
    data: {
      name: "OWNER",
      protected: true,
      permissions: {
        create: permissions.map((permissionKey) => ({ permissionKey })),
      },
    },
  });
  const user = await db.user.create({
    data: {
      name: "اختبار محلي",
      email: "local@example.test",
      passwordHash: await hash(password),
      roles: { create: { roleId: role.id } },
    },
  });
  const branch = await db.branch.create({ data: { name: "فرع اختبار محلي" } });
  await db.stockLocation.create({
    data: { name: "مخزن اختبار محلي", branchId: branch.id },
  });

  const category = await db.category.create({ data: { name: "ملابس اختبار" } });
  // Identical timestamps prove the id tie-breaker prevents unstable page boundaries.
  for (let i = 0; i < 157; i++) {
    await db.product.create({
      data: {
        nameAr: i === 0 ? "بُلوزة أَنيقة هدى" : `صنف تجريبي ${i}`,
        sku: `PRODUCT-${i}`,
        categoryId: category.id,
        createdBy: user.id,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        variants: {
          create: {
            sku: `STYLE-${i}`,
            barcode: `622000${String(i).padStart(6, "0")}`,
            price: 200,
            cost: 100,
            options: { المقاس: "L", اللون: i === 0 ? "أزرق" : "وردي" },
          },
        },
      },
      include: { variants: true },
    });
  }
  await seedPaginationLists(db);
  const app = (await import("../apps/api/src/app")).default;
  api = app.listen(3001, "127.0.0.1");
  web = await preview({
    root: resolve("apps/web"),
    preview: { host: "127.0.0.1", port: 5173, strictPort: true },
  });

  browser = await chromium.launch({
    ...(process.env.BROWSER_CHANNEL
      ? { channel: process.env.BROWSER_CHANNEL }
      : { executablePath: "/usr/bin/google-chrome" }),
    headless: true,
  });
  await mkdir("test-results/pagination", { recursive: true });
}, 120000);
afterAll(async () => {
  await browser?.close();
  if (web)
    await new Promise<void>((done) => web.httpServer.close(() => done()));
  if (api) await new Promise<void>((done) => api.close(() => done()));
  await db?.$disconnect();
  await pg?.stop();
}, 120000);
describe("populated local pagination evidence", () => {
  it("bounds entity options and omits inactive, archived and protected choices", async () => {
    const context = await browser.newContext();
    await context.request.post("http://127.0.0.1:3001/api/auth/login", {
      headers: { Origin: "http://127.0.0.1:5173" },
      data: { email: "local@example.test", password },
    });
    const hidden = await db.category.create({
      data: { name: "Archived option", archivedAt: new Date() },
    });
    await db.category.createMany({
      data: Array.from({ length: 65 }, (_, i) => ({
        name: `Picker category ${String(i).padStart(3, "0")}`,
      })),
    });
    const response = await context.request.get(
      "http://127.0.0.1:3001/api/options/categories?q=Picker",
    );
    expect(response.status()).toBe(200);
    const first = await response.json();
    expect(first.data).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    const second = await (
      await context.request.get(
        "http://127.0.0.1:3001/api/options/categories?q=Picker&offset=50",
      )
    ).json();
    expect(second.data).toHaveLength(15);
    expect(second.hasMore).toBe(false);
    expect(
      new Set([...first.data, ...second.data].map((r: { id: string }) => r.id))
        .size,
    ).toBe(65);
    const archived = await (
      await context.request.get(
        "http://127.0.0.1:3001/api/options/categories?q=Archived",
      )
    ).json();
    expect(archived.data).toHaveLength(0);
    const chosen = await (
      await context.request.get(
        `http://127.0.0.1:3001/api/options/categories?selected=${hidden.id}`,
      )
    ).json();
    expect(chosen.selected.id).toBe(hidden.id);
    const roles = await (
      await context.request.get(
        "http://127.0.0.1:3001/api/options/roles?assignable=1",
      )
    ).json();
    expect(roles.data.every((r: { name: string }) => r.name !== "OWNER")).toBe(
      true,
    );
    const balance = await db.stockBalance.findFirstOrThrow();
    const lowVariant = await db.productVariant.findUniqueOrThrow({
      where: { id: balance.variantId },
    });
    await db.productVariant.update({
      where: { id: lowVariant.id },
      data: { minStock: 100000 },
    });
    const low = await (
      await context.request.get(
        "http://127.0.0.1:3001/api/inventory?page=1&pageSize=25&low=1",
      )
    ).json();
    expect(low.total).toBeGreaterThan(0);
    expect(
      low.data.every(
        (r: { quantity: number; variant: { minStock: number } }) =>
          r.quantity <= r.variant.minStock,
      ),
    ).toBe(true);
    const empty = await (
      await context.request.get(
        "http://127.0.0.1:3001/api/inventory?page=1&pageSize=25&low=1&q=no-matching-stock",
      )
    ).json();
    expect(empty.total).toBe(0);
    expect(empty.data).toHaveLength(0);
    await context.close();
  });

  it.each([1440, 390])(
    "captures populated list page2 and50 rows at %spx",
    async (width) => {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
      });
      (await import("../apps/api/src/app")).apiRateLimiter.resetKey(
        "127.0.0.1",
      );
      await context.request.post("http://127.0.0.1:3001/api/auth/login", {
        headers: { Origin: "http://127.0.0.1:5173" },
        data: { email: "local@example.test", password },
      });
      const page = await context.newPage();
      const { apiRateLimiter } = await import("../apps/api/src/app");
      const resetRateLimit = () => apiRateLimiter.resetKey("127.0.0.1");
      page.on("response", (r) => {
        if (r.status() >= 400)
          console.error("evidence HTTP", r.status(), r.url());
      });
      page.setDefaultTimeout(8000);
      for (const [route, name] of [
        ["sales", "sales"],
        ["purchases", "purchases"],
        ["inventory", "inventory"],
        ["expenses", "expenses"],
        ["inventory/advanced", "shipments"],
        ["suppliers", "suppliers"],
        ["promotions", "promotions"],
        ["discount-approvals", "approvals"],
        ["customers", "customers"],
        ["audit-logs", "audit"],
      ]) {
        resetRateLimit();
        await page.goto(`http://127.0.0.1:5173/${route}`);
        const nav = page.getByRole("navigation", {
          name: "التنقل بين الصفحات",
        });
        resetRateLimit();
        await ui(nav).toBeVisible();
        await nav.getByRole("button", { name: "التالي", exact: true }).click();
        await ui(nav.getByText(/صفحة 2 من/)).toBeVisible();
        await nav.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `test-results/pagination/populated-${name}-page2-${width}.png`,
        });
        await nav
          .getByRole("combobox", { name: "عدد العناصر في الصفحة" })
          .selectOption("50");
        await ui(nav.getByText(/صفحة 1 من/)).toBeVisible();
        await ui(nav.getByText(/1–50 من/)).toBeVisible();
        await nav.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `test-results/pagination/populated-${name}-size50-${width}.png`,
        });
      }

      async function capture(
        name: string,
        nav = page
          .getByRole("navigation", { name: "التنقل بين الصفحات" })
          .last(),
      ) {
        resetRateLimit();
        await ui(nav).toBeVisible();
        await nav.getByRole("button", { name: "التالي", exact: true }).click();
        await ui(nav.getByText(/صفحة 2 من/)).toBeVisible();
        await nav.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `test-results/pagination/populated-${name}-page2-${width}.png`,
        });
        await nav
          .getByRole("combobox", { name: "عدد العناصر في الصفحة" })
          .selectOption("50");
        await ui(nav.getByText(/1–50 من/)).toBeVisible();
        await nav.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `test-results/pagination/populated-${name}-size50-${width}.png`,
        });
      }
      for (const [tab, name] of [
        ["سجل الحركات", "movements"],
        ["جلسات الجرد", "counts"],
        ["التحويلات والتالف والتسويات", "stock-documents"],
      ]) {
        resetRateLimit();
        await page.goto("http://127.0.0.1:5173/inventory");
        await page.getByRole("button", { name: tab, exact: true }).click();
        await capture(name);
      }
      resetRateLimit();
      await page.goto("http://127.0.0.1:5173/inventory/advanced");
      await page
        .getByRole("button", { name: "المخزون المحجور", exact: true })
        .click();
      await capture("holds");
      for (const route of ["users", "roles", "shifts"]) {
        resetRateLimit();
        await page.goto(`http://127.0.0.1:5173/${route}`);
        await capture(route);
      }
      resetRateLimit();
      await page.goto("http://127.0.0.1:5173/administration");
      await page
        .getByRole("button", { name: "عرض المخازن والأجهزة", exact: true })
        .first()
        .click();
      const branchCard = page.locator("section.management-card").filter({
        has: page.getByRole("button", {
          name: "إخفاء المخازن والأجهزة",
          exact: true,
        }),
      });
      await capture(
        "branch-locations",
        branchCard
          .getByRole("navigation", { name: "التنقل بين الصفحات" })
          .first(),
      );
      await capture(
        "branch-registers",
        branchCard
          .getByRole("navigation", { name: "التنقل بين الصفحات" })
          .last(),
      );
      await capture(
        "branches",
        page.getByRole("navigation", { name: "التنقل بين الصفحات" }).last(),
      );
      await page
        .getByRole("button", { name: "جلسات الدخول", exact: true })
        .click();
      await capture("sessions");
      resetRateLimit();
      await page.goto("http://127.0.0.1:5173/expenses");
      await page
        .getByRole("button", { name: "تصنيفات المصروفات", exact: true })
        .click();
      await capture("expense-categories");
      resetRateLimit();
      await page.goto("http://127.0.0.1:5173/reports");
      await page
        .getByLabel("نوع التقرير", { exact: true })
        .selectOption("movements");
      await capture("report-movements");
      const supplier = await db.supplier.findFirstOrThrow();
      for (const [tab, name] of [
        ["كشف الحساب", "supplier-statement"],
        ["فواتير المورد", "supplier-invoices"],
        ["مرتجعات المشتريات", "supplier-returns"],
      ]) {
        resetRateLimit();
        await page.goto(`http://127.0.0.1:5173/suppliers/${supplier.id}`);
        await page.getByRole("button", { name: tab, exact: true }).click();
        await capture(name);
      }
      resetRateLimit();
      await page.goto("http://127.0.0.1:5173/customers");
      const customer = await db.customer.findFirstOrThrow();
      await page.getByRole("textbox", { name: /بحث/ }).fill(customer.phone);
      await page
        .getByRole("button", { name: "سجل العميل", exact: true })
        .click();
      const historyNav = page
        .getByRole("dialog")
        .getByRole("navigation", { name: "التنقل بين الصفحات" });
      await capture(
        "loyalty",
        page
          .getByRole("dialog")
          .locator("section")
          .filter({
            has: page.getByRole("heading", {
              name: "نقاط الولاء",
              exact: true,
            }),
          })
          .getByRole("navigation", { name: "التنقل بين الصفحات" }),
      );
      await capture("customer-sales", historyNav.last());
      await page
        .getByRole("button", { name: "المرتجعات", exact: true })
        .click();
      await capture("customer-returns", historyNav.last());

      resetRateLimit();
      await page.goto("http://127.0.0.1:5173/products");
      await page
        .getByRole("button", { name: "أرشيف المنتجات", exact: true })
        .click();
      await capture("archived-products");
      await page.getByRole("button", { name: "التصنيف", exact: true }).click();
      await capture(
        "categories",
        page
          .getByRole("dialog")
          .getByRole("navigation", { name: "التنقل بين الصفحات" }),
      );
      await page.getByRole("button", { name: "الأرشيف", exact: true }).click();
      await capture(
        "archived-categories",
        page
          .getByRole("dialog")
          .getByRole("navigation", { name: "التنقل بين الصفحات" }),
      );
      resetRateLimit();
      await page.goto("http://127.0.0.1:5173/promotions");
      await page
        .getByRole("button", { name: "إضافة عرض", exact: true })
        .click();
      await page
        .getByLabel("المنتجات المشمولة", { exact: true })
        .selectOption("selected");
      await capture(
        "promotion-products",
        page
          .getByRole("dialog")
          .getByRole("navigation", { name: "التنقل بين الصفحات" }),
      );
      resetRateLimit();
      await page.goto("http://127.0.0.1:5173/pos");
      await ui(
        page.locator(".pos-catalog .list-pagination .pagination-range"),
      ).toContainText("157");
      await ui(page.locator("fieldset.pos-workspace")).toBeEnabled();

      await capture(
        "pos-catalog",
        page.locator(".pos-catalog .list-pagination"),
      );
      await context.close();
    },
    180000,
  );
});
