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
let pgPort: number;
const password = randomBytes(24).toString("hex");

beforeAll(async () => {
  await mkdir(".test-data", { recursive: true });
  const {createServer:socketServer}=await import("node:net");
  pgPort=await new Promise<number>((done)=>{const server=socketServer();server.listen(0,"127.0.0.1",()=>{const port=(server.address() as {port:number}).port;server.close(()=>done(port))})});
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
  await mkdir("test-results/pagination", { recursive: true });
}, 120000);
afterAll(async () => {
  await browser?.close();
  await web?.close();
  if (api) await new Promise<void>((done) => api.close(() => done()));
  await db?.$disconnect();
  await pg?.stop();
}, 120000);
describe("unified product pagination", () => {
  it("validates every page size and preserves legacy callers", async () => {
    const context = await browser.newContext();
    const login = await context.request.post(
      "http://127.0.0.1:3001/api/auth/login",
      {
        headers: { Origin: "http://127.0.0.1:5173" },
        data: { email: "local@example.test", password },
      },
    );
    expect(login.status()).toBe(200);
    for (const size of [25, 50, 100, 150]) {
      const response = await context.request.get(
        `http://127.0.0.1:3001/api/products?page=1&pageSize=${size}`,
      );
      const body = await response.json();
      expect(body.data).toHaveLength(size);
      expect(body).toMatchObject({
        total: 157,
        page: 1,
        pageSize: size,
        hasNext: true,
      });
      const next = await (
        await context.request.get(
          `http://127.0.0.1:3001/api/products?page=2&pageSize=${size}`,
        )
      ).json();
      expect(
        next.data.some((r: { id: string }) =>
          body.data.some((p: { id: string }) => p.id === r.id),
        ),
      ).toBe(false);
    }
    expect(
      (
        await (
          await context.request.get("http://127.0.0.1:3001/api/products?page=1")
        ).json()
      ).data,
    ).toHaveLength(25);
    expect(
      (
        await (
          await context.request.get("http://127.0.0.1:3001/api/products")
        ).json()
      ).data,
    ).toHaveLength(30);
    expect(
      (
        await context.request.get(
          "http://127.0.0.1:3001/api/products?pageSize=30",
        )
      ).status(),
    ).toBe(400);
    const last = await (
      await context.request.get(
        "http://127.0.0.1:3001/api/products?page=7&pageSize=25",
      )
    ).json();
    expect(last.data).toHaveLength(7);
    expect(last.hasNext).toBe(false);
    const filtered = await (
      await context.request.get(
        "http://127.0.0.1:3001/api/products?page=1&q=156",
      )
    ).json();
    expect(filtered.total).toBe(1);
    expect(filtered.data).toHaveLength(1);
    const archived = await (
      await context.request.get(
        "http://127.0.0.1:3001/api/products?page=1&archived=1",
      )
    ).json();
    expect(archived.total).toBe(0);
    expect(archived.data).toHaveLength(0);
    for (const suffix of [
      "page=0",
      "page=-1",
      "page=1.5",
      "pageSize=25&pageSize=50",
      "pageSize=151",
    ]) {
      expect(
        (
          await context.request.get(
            `http://127.0.0.1:3001/api/products?${suffix}`,
          )
        ).status(),
      ).toBe(400);
    }
    await context.close();
  });
  it.each([1440, 390, 320])(
    "shows real RTL pagination and preserves barcode selection at %spx",
    async (width) => {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
      });
      await context.request.post("http://127.0.0.1:3001/api/auth/login", {
        headers: { Origin: "http://127.0.0.1:5173" },
        data: { email: "local@example.test", password },
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.setDefaultTimeout(5000);
      let release: () => void = () => {};
      let gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/products?**", async (route) => {
        await gate;
        await route.continue();
      });
      await page.goto("http://127.0.0.1:5173/products");
      await ui(
        page.getByRole("status", { name: "جارٍ تحميل المنتجات", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: `test-results/pagination/products-skeleton-${width}.png`,
      });
      release();
      await page.unrouteAll({ behavior: "wait" });
      const nav = page.getByRole("navigation", { name: "التنقل بين الصفحات" });
      await ui(nav.getByText("1–25 من 157 منتج")).toBeVisible();
      await nav.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `test-results/pagination/products-${width}.png`,
      });
      await nav.getByRole("button", { name: "التالي", exact: true }).click();
      await ui(nav.getByText("26–50 من 157 منتج")).toBeVisible();
      await page
        .getByRole("combobox", { name: "عدد العناصر في الصفحة" })
        .selectOption("150");
      await ui(nav.getByText("1–150 من 157 منتج")).toBeVisible();
      await page.locator(".toolbar input").fill("no-such-product");
      await ui(nav.getByText("0–0 من 0 منتج")).toBeVisible();
      await page.locator(".toolbar input").fill("156");
      await page.locator(".toolbar input").fill("155");
      await ui(nav.getByText("1–1 من 1 منتج")).toBeVisible();
      await ui(page.getByText("صنف تجريبي 155", { exact: true })).toBeVisible();
      await page.locator(".toolbar input").fill("no-such-product");
      await ui(nav.getByText("0–0 من 0 منتج")).toBeVisible();
      await ui(
        nav.getByRole("button", { name: "التالي", exact: true }),
      ).toBeDisabled();
      await page.locator(".toolbar input").fill("");
      await ui(nav.getByText("1–150 من 157 منتج")).toBeVisible();
      await nav.getByRole("button", { name: "التالي", exact: true }).click();
      await ui(nav.getByText("151–157 من 157 منتج")).toBeVisible();
      await page.reload();
      await ui(nav.getByText("151–157 من 157 منتج")).toBeVisible();
      await page
        .getByRole("button", { name: "أرشيف المنتجات", exact: true })
        .click();
      await ui(nav.getByText("0–0 من 0 منتج")).toBeVisible();
      await page
        .getByRole("button", { name: "المنتجات الحالية", exact: true })
        .click();
      await ui(nav.getByText("1–150 من 157 منتج")).toBeVisible();
      if (width !== 320) {
        for (const [route, name] of [
          ["sales", "sales"],
          ["purchases", "purchases"],
          ["inventory", "inventory"],
          ["expenses", "expenses"],
          ["inventory/advanced", "advanced"],
            ["suppliers","suppliers"],
            ["promotions","promotions"],
            ["discount-approvals","approvals"],
            ["customers","customers"],
            ["users","users"],
            ["audit-logs","audit"],
        ]) {
          await page.goto(`http://127.0.0.1:5173/${route}`);
          await ui(nav).toBeVisible();
          if (await nav.count()) {
            await nav.scrollIntoViewIfNeeded();
            await page.screenshot({
              path: `test-results/pagination/batch2-${name}-${width}.png`,
            });
          }
        }
      }
      await page.goto("http://127.0.0.1:5173/products?page=99&pageSize=25");
      await ui(nav.getByText("151–157 من 157 منتج")).toBeVisible();
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/products?**", async (route) => {
        await gate;
        await route.continue();
      });
      await page.goto("http://127.0.0.1:5173/products/barcodes");
      await ui(
        page.getByRole("status", {
          name: "جارٍ تحميل منتجات الباركود",
          exact: true,
        }),
      ).toBeVisible();
      await page.screenshot({
        path: `test-results/pagination/barcodes-skeleton-${width}.png`,
      });
      release();
      await page.unrouteAll({ behavior: "wait" });
      await ui(nav.getByText("1–25 من 157 منتج")).toBeVisible();
      const first = page
        .getByRole("checkbox", { name: /^اختيار STYLE-/ })
        .first();
      const selectedName = await first.getAttribute("aria-label");
      await first.check();
      await nav.getByRole("button", { name: "التالي", exact: true }).click();
      await ui(nav.getByText("26–50 من 157 منتج")).toBeVisible();
      await nav.getByRole("button", { name: "السابق", exact: true }).click();
      await ui(
        page.getByRole("checkbox", { name: selectedName!, exact: true }),
      ).toBeChecked();
      await nav.getByRole("button", { name: "التالي", exact: true }).click();
      await ui(nav.getByText("26–50 من 157 منتج")).toBeVisible();
      await nav.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `test-results/pagination/barcodes-${width}.png`,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
      await context.close();
    },
  );
});
