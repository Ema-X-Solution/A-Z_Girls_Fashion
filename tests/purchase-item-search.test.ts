import { beforeAll, afterAll, describe, it, expect } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { chromium, expect as ui, type Browser } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Server } from "node:http";
import type { PrismaClient } from "@prisma/client";
let pg: EmbeddedPostgres,
  db: PrismaClient,
  browser: Browser,
  web: ViteDevServer,
  api: Server;
const password = randomBytes(24).toString("hex");
let supplierId: string, locationId: string, targetId: string;
beforeAll(async () => {
  await mkdir(".test-data", { recursive: true });
  const { createServer: createSocketServer } = await import("node:net");
  const port = await new Promise<number>((done) => {
    const server = createSocketServer();
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => done(port));
    });
  });
  pg = new EmbeddedPostgres({
    databaseDir: await mkdtemp(resolve(".test-data/item-search-")),
    user: "az_test",
    password,
    port,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-h", "127.0.0.1"],
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("az_search");
  process.env.DATABASE_URL = `postgresql://az_test:${password}@127.0.0.1:${port}/az_search`;
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
  locationId = (
    await db.stockLocation.create({
      data: { name: "مخزن اختبار محلي", branchId: branch.id },
    })
  ).id;
  supplierId = (
    await db.supplier.create({ data: { name: "مورد اختبار محلي" } })
  ).id;
  const category = await db.category.create({ data: { name: "ملابس اختبار" } });
  // Target is oldest, deliberately beyond the first two 100-product pages.
  for (let i = 0; i < 1005; i++) {
    const p = await db.product.create({
      data: {
        nameAr: i === 0 ? "بُلوزة أَنيقة هدى" : `صنف تجريبي ${i}`,
        sku: `PRODUCT-${i}`,
        categoryId: category.id,
        createdBy: user.id,
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
    if (i === 0) targetId = p.variants[0].id;
  }
  const app = (await import("../apps/api/src/app")).default;
  api = app.listen(3001, "127.0.0.1");
  web = await createServer({
    root: resolve("apps/web"),
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
  });
  await web.listen();
  browser = await chromium.launch({
    ...(process.env.BROWSER_CHANNEL
      ? { channel: process.env.BROWSER_CHANNEL }
      : { executablePath: "/usr/bin/google-chrome" }),
    headless: true,
  });
  await mkdir("test-results/item-search", { recursive: true });
}, 120000);
afterAll(async () => {
  await browser?.close();
  await web?.close();
  if (api) await new Promise<void>((done) => api.close(() => done()));
  await db?.$disconnect();
  await pg?.stop();
}, 120000);
describe("purchase item search", () => {
  it.each([1440, 390, 320])(
    "searches all 1005 products and saves to local database at %spx",
    async (width) => {
      const context = await browser.newContext({
        viewport: { width, height: 1100 },
      });
      try {
        const login = await context.request.post(
          "http://127.0.0.1:3001/api/auth/login",
          {
            headers: { Origin: "http://127.0.0.1:5173" },
            data: { email: "local@example.test", password },
          },
        );
        expect(login.status()).toBe(200);
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto("http://127.0.0.1:5173/purchases");
        await page
          .getByRole("button", { name: "أمر شراء جديد", exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        await dialog.locator('[name="supplierId"]').selectOption(supplierId);
        await dialog.locator('[name="locationId"]').selectOption(locationId);
        const search = dialog.getByRole("searchbox", { name: "بحث عن الصنف" });
        await ui(search).toBeVisible();
        const picker = dialog.locator('[name="v0"]');
        await ui(picker.locator("option")).toHaveCount(51);
        await dialog
          .locator('.smart-select:has([name="v0"])')
          .getByRole("button", { name: "التالي", exact: true })
          .click();
        await ui(
          dialog.locator('.smart-select:has([name="v0"])').getByRole("status"),
        ).toContainText("صفحة 2");
        await ui(picker.locator("option")).toHaveCount(51);
        await search.fill("بلوزه انيقه هدي");
        await ui(
          dialog.locator('.smart-select:has([name="v0"])').getByRole("status"),
        ).toHaveText("1 نتيجة • صفحة 1");
        await ui(picker.locator("option")).toHaveCount(2);
        await page.screenshot({
          path: `test-results/item-search/search-${width}.png`,
          fullPage: true,
        });
        await search.press("Enter");
        await ui(dialog).toBeVisible();
        await search.fill("STYLE-0");
        await ui(
          dialog.locator('.smart-select:has([name="v0"])').getByRole("status"),
        ).toHaveText("1 نتيجة • صفحة 1");
        await search.fill("٦٢٢٠٠٠٠٠٠٠٠٠");
        await ui(
          dialog.locator('.smart-select:has([name="v0"])').getByRole("status"),
        ).toHaveText("1 نتيجة • صفحة 1");
        await search.fill("ازرق L");
        await ui(
          dialog.locator('.smart-select:has([name="v0"])').getByRole("status"),
        ).toHaveText("1 نتيجة • صفحة 1");
        await picker.selectOption(targetId);
        await ui(search).toHaveValue("");
        await ui(dialog.locator('[name="c0"]')).toHaveValue("100");
        await search.fill("غير موجود نهائيا");
        await ui(
          dialog.locator('.smart-select:has([name="v0"])').getByRole("status"),
        ).toContainText("لا توجد أصناف مطابقة");
        await ui(picker).toHaveValue(targetId);
        await page.screenshot({
          path: `test-results/item-search/no-results-${width}.png`,
          fullPage: true,
        });
        await search.fill("");
        await dialog.locator('[name="q0"]').fill("3");
        await dialog.locator('[name="sp0"]').fill("200");
        expect(
          await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
        const saved = page.waitForResponse(
          (r) =>
            r.url().endsWith("/api/purchases") &&
            r.request().method() === "POST",
        );
        await dialog.getByRole("button", { name: "حفظ", exact: true }).click();
        expect((await saved).status()).toBe(201);
        await ui(dialog).not.toBeVisible();
        const order = await db.purchaseOrder.findFirstOrThrow({
          orderBy: { createdAt: "desc" },
          include: { items: true },
        });
        expect(order.items[0].variantId).toBe(targetId);
        expect(order.items[0].quantity).toBe(3);
        expect(order.status).toBe("DRAFT");
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    },
    60000,
  );
});
