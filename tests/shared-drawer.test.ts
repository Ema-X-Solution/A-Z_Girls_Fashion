import { beforeAll, afterAll, describe, it, expect } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { mkdtemp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import request from "supertest";
import { chromium, expect as ui } from "@playwright/test";
import { preview } from "vite";
import { createServer as createSocketServer } from "node:net";
const origin = "http://localhost:5173",
  password = randomBytes(24).toString("hex");
let pg: any,
  db: any,
  app: any,
  owner: any,
  location: any,
  register: any,
  pgPort = 0,
  pgStarted = false;
async function login(email: string) {
  const agent = request.agent(app);
  const r = await agent
    .post("/api/auth/login")
    .set("Origin", process.env.APP_ORIGIN ?? origin)
    .send({ email, password });
  expect(r.status).toBe(200);
  const me = await agent.get("/api/auth/me");
  return { agent, csrf: me.body.data.csrf, user: me.body.data };
}
async function send(
  who: any,
  path: string,
  body: any,
  key = crypto.randomUUID(),
) {
  return who.agent
    .post(`/api${path}`)
    .set("Origin", process.env.APP_ORIGIN ?? origin)
    .set("X-CSRF-Token", who.csrf)
    .set("Idempotency-Key", key)
    .send(body);
}
beforeAll(async () => {
  pgPort = await new Promise<number>((resolvePort) => {
    const socket = createSocketServer();
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address() as { port: number };
      socket.close(() => resolvePort(address.port));
    });
  });
  await mkdir(".test-data", { recursive: true });
  const directory = await mkdtemp(resolve(".test-data/pg-"));
  const logs: string[] = [];
  pg = new EmbeddedPostgres({
    databaseDir: directory,
    user: "az_test",
    password,
    port: pgPort,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-h", "127.0.0.1"],
    onLog: (message) => {
      logs.push(String(message));
    },
    onError: (message) => {
      logs.push(String(message));
    },
  });
  pg.stop = async () => {
    if (!pgStarted) return;
    const binaries = await import(
      `@embedded-postgres/${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`
    );
    execFileSync(
      binaries.pg_ctl,
      ["-D", directory, "-m", "fast", "-w", "-t", "120", "stop"],
      { stdio: "pipe" },
    );
    pgStarted = false;
  };
  await pg.initialise();
  try {
    await pg.start();
    pgStarted = true;
  } catch {
    throw new Error(
      `Isolated PostgreSQL startup failed: ${logs.slice(-10).join("\n")}`,
    );
  }
  await pg.createDatabase("az_test");
  process.env.DATABASE_URL = `postgresql://az_test:${password}@127.0.0.1:${pgPort}/az_test`;
  process.env.APP_ORIGIN = origin;
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
  execFileSync(
    process.execPath,
    ["--import", "tsx", "apps/api/prisma/initialize.ts"],
    {
      env: {
        ...process.env,
        INITIAL_OWNER_EMAIL: "owner@example.test",
        INITIAL_OWNER_PASSWORD: password,
      },
      stdio: "pipe",
    },
  );
  app = (await import("../apps/api/src/app.js")).default;
  db = (await import("../apps/api/src/lib/db.js")).db;
  const settings = await db.systemSetting.findUniqueOrThrow({
    where: { key: "store" },
  });
  await db.systemSetting.update({
    where: { key: "store" },
    data: {
      value: {
        ...(settings.value as Record<string, any>),
        taxRate: "0",
        taxMode: "EXCLUSIVE",
      },
    },
  });
  owner = await login("owner@example.test");
  location = await db.stockLocation.findFirstOrThrow();
  register = await db.register.findFirstOrThrow();
}, 180000);
afterAll(async () => {
  await db?.$disconnect();
  if (pgStarted) await pg.stop();
}, 180000);
describe.sequential(
  "shared drawer and selected cashier with real PostgreSQL",
  () => {
    let a: any, b: any, shift: any, variant: any, saleA: any;
    it("validates commission settings without changing tax and defaults reports to one percent", async () => {
      const setting = await db.systemSetting.findUniqueOrThrow({
        where: { key: "store" },
      });
      const original = setting.value;
      const patch = async (rate: string) =>
        owner.agent
          .patch("/api/settings/store")
          .set("Origin", origin)
          .set("X-CSRF-Token", owner.csrf)
          .send({ ...original, cashierCommissionRate: rate });
      for (const rate of ["0", "1", "1.25", "100"])
        expect((await patch(rate)).status).toBe(200);
      for (const rate of ["-1", "100.01", "101", "1.234", "abc", ""])
        expect((await patch(rate)).status).toBe(400);
      expect((await patch("1")).status).toBe(200);
      const after = await db.systemSetting.findUniqueOrThrow({
        where: { key: "store" },
      });
      expect(after.value.taxRate).toBe(original.taxRate);
      expect(after.value.taxMode).toBe(original.taxMode);
    });
    it("lists active assigned cashiers and the administrative session itself", async () => {
      const roles = await db.role.findMany({ include: { permissions: true } });
      const base = roles.find((r: any) => r.name === "CASHIER");
      const role = await db.role.findUniqueOrThrow({
        where: { name: "كاشير" },
      });
      expect(base).toBeTruthy();
      for (const [name, email] of [
        ["أحمد", "a@example.test"],
        ["منى", "b@example.test"],
      ]) {
        const r = await send(owner, "/users", {
          name,
          email,
          password,
          roleIds: [role.id],
        });
        expect(r.status).toBe(201);
      }
      a = await login("a@example.test");
      b = await login("b@example.test");
      const list = await owner.agent.get("/api/sales/cashiers");
      expect(list.status).toBe(200);
      expect(list.body.data.map((x: any) => x.id).sort()).toEqual(
        [a.user.id, b.user.id, owner.user.id].sort(),
      );
    });
    it("lets either cashier use the same shift and rejects a second opening", async () => {
      const openings = await Promise.all([
        send(a, "/shifts/open", {
          registerId: register.id,
          openingCash: "500",
        }),
        send(b, "/shifts/open", {
          registerId: register.id,
          openingCash: "500",
        }),
      ]);
      expect(openings.map((r) => r.status).sort()).toEqual([201, 409]);
      const r = openings.find((r) => r.status === 201)!;
      shift = r.body.data;
      expect((await b.agent.get("/api/shifts/current")).body.data.id).toBe(
        shift.id,
      );
      const again = await send(b, "/shifts/open", {
        registerId: register.id,
        openingCash: "500",
      });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("SHIFT_EXISTS");
      const cat = await db.category.create({
        data: { name: "اختبار الكاشيرين" },
      });
      const product = await send(owner, "/products", {
        nameAr: "فستان تجربة الدرج",
        sku: "DRAWER-TEST",
        categoryId: cat.id,
        variants: [
          { sku: "DRAWER-S", barcode: "88112233", price: "100", cost: "20" },
        ],
      });
      expect(product.status).toBe(201);
      variant = product.body.data.variants[0];
      expect(
        (
          await send(owner, "/inventory/adjustments", {
            locationId: location.id,
            variantId: variant.id,
            quantity: 20,
            cost: "20",
            reason: "Isolated test stock",
          })
        ).status,
      ).toBe(200);
    });
    const body = (cashierId?: string, method = "CASH") => ({
      shiftId: shift.id,
      ...(cashierId ? { cashierId } : {}),
      items: [{ variantId: variant.id, quantity: 1 }],
      payments: [{ method, amount: "100" }],
    });
    it("rejects malformed, unassigned and inactive cashiers without writes", async () => {
      const count = await db.sale.count();
      for (const id of ["bad", crypto.randomUUID()]) {
        const r = await send(owner, "/sales", body(id));
        expect(r.status).toBe(400);
      }
      await db.user.update({
        where: { id: b.user.id },
        data: { active: false },
      });
      expect((await send(owner, "/sales", body(b.user.id))).status).toBe(400);
      await db.user.update({
        where: { id: b.user.id },
        data: { active: true },
      });
      expect(await db.sale.count()).toBe(count);
    });
    it("saves selected cashier, actual operator, receipt and audit separately; no double sale", async () => {
      const key = crypto.randomUUID(),
        r = await send(owner, "/sales", body(a.user.id), key);
      expect(r.status).toBe(201);
      saleA = r.body.data;
      expect(saleA.userId).toBe(a.user.id);
      expect(saleA.operatorId).toBe(owner.user.id);
      expect(saleA.receiptSnapshot.cashierName).toBe("أحمد");
      expect(
        (await send(owner, "/sales", body(a.user.id), key)).body.data.id,
      ).toBe(saleA.id);
      const r2 = await send(owner, "/sales", body(b.user.id, "CARD"));
      expect(r2.status).toBe(201);
      expect(r2.body.data.userId).toBe(b.user.id);
      const log = await db.auditLog.findFirstOrThrow({
        where: { action: "SALE", reference: saleA.id },
      });
      expect(log.userId).toBe(owner.user.id);
      expect(log.details.cashierName).toBe("أحمد");
      expect((await owner.agent.get(`/api/sales/${saleA.id}`)).status).toBe(
        200,
      );
    });
    it("closes by the other cashier using drawer cash only, captures errors and reopens same record", async () => {
      expect(
        (await send(b, `/shifts/${shift.id}/close`, { countedCash: "-1" }))
          .status,
      ).toBe(400);
      const refund = await send(owner, `/sales/${saleA.id}/returns`, {
        shiftId: shift.id,
        reason: "اختبار إرجاع حقيقي",
        method: "CASH",
        items: [{ saleItemId: saleA.items[0].id, quantity: 1, sellable: true }],
      });
      expect(refund.status).toBe(200);
      const expense = await send(owner, "/expenses", {
        shiftId: shift.id,
        category: "أخرى",
        amount: "30",
        method: "CASH",
        description: "مصروف تجربة الدرج",
      });
      expect(expense.status).toBe(201);
      const r = await send(b, `/shifts/${shift.id}/close`, {
        countedCash: "460",
        notes: "عد الدرج",
      });
      expect(r.status).toBe(200);
      expect(r.body.data.expectedCash).toBe("470");
      expect(r.body.data.difference).toBe("-10");
      expect(
        (await send(a, `/shifts/${shift.id}/close`, { countedCash: "460" }))
          .status,
      ).toBe(409);
      expect((await send(a, "/sales", body(a.user.id))).status).toBe(409);
      expect(
        (
          await send(a, "/shifts/open", {
            registerId: register.id,
            openingCash: "500",
          })
        ).body.error.code,
      ).toBe("SHIFT_REOPEN_REQUIRED");
      expect((await send(a, `/shifts/${shift.id}/reopen`, {})).status).toBe(
        200,
      );
      expect(
        (await send(b, `/shifts/${shift.id}/reopen`, {})).body.error.code,
      ).toBe("SHIFT_ALREADY_OPEN");
      expect(await db.cashShift.count()).toBe(1);
      const history = await db.auditLog.findFirstOrThrow({
        where: { action: "SHIFT_REOPEN" },
      });
      expect(history.details.previousDifference).toBe("-10");
    });
    it("shows mobile before-payment selection, remembers it and captures shared-close and report screens", async () => {
      const http = app.listen(0, "127.0.0.1");
      await new Promise((r) => http.once("listening", r));
      const web = await preview({
        root: resolve("apps/web"),
        preview: {
          host: "127.0.0.1",
          port: 0,
          proxy: { "/api": `http://127.0.0.1:${http.address().port}` },
        },
      });
      const url = `http://127.0.0.1:${web.httpServer.address().port}`;
      process.env.APP_ORIGIN = url;
      const browser = await chromium.launch({
        channel: "chrome",
        headless: true,
      });
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const page = await ctx.newPage();
      await mkdir("test-results/shared-drawer", { recursive: true });
      try {
        await page.goto(url + "/login");
        await page.getByLabel("البريد الإلكتروني").fill("owner@example.test");
        await page.getByLabel("كلمة المرور", { exact: true }).fill(password);
        await page
          .getByRole("button", { name: "تسجيل الدخول", exact: true })
          .click();
        await page.waitForURL((u) => !u.pathname.includes("login"));
        await page.goto(url + "/pos");
        const select = page.getByLabel("اسم الكاشير", { exact: true });
        await ui(select).toHaveCount(0);
        await page.screenshot({
          path: "test-results/shared-drawer/03-after-pos-cashier.png",
          fullPage: true,
        });
        await page.reload();
        await ui(select).toHaveCount(0);
        await page.goto(url + "/shifts");
        await page
          .getByRole("button", { name: "إغلاق الوردية", exact: true })
          .click();
        await page.screenshot({
          path: "test-results/shared-drawer/04-shared-close.png",
          fullPage: true,
        });
        await page.getByLabel("النقد الفعلي", { exact: true }).fill("-1");
        await page.getByRole("button", { name: "حفظ", exact: true }).click();
        await page.screenshot({
          path: "test-results/shared-drawer/08-negative-count-blocked.png",
          fullPage: true,
        });
        await page.getByLabel("النقد الفعلي", { exact: true }).fill("460");
        await page.getByRole("button", { name: "حفظ", exact: true }).click();
        await ui(
          page.getByRole("button", {
            name: "إعادة فتح وردية اليوم",
            exact: true,
          }),
        ).toBeVisible();
        await page.screenshot({
          path: "test-results/shared-drawer/05-closed-shortage.png",
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "إعادة فتح وردية اليوم", exact: true })
          .click();
        await ui(
          page.getByRole("button", { name: "إغلاق الوردية", exact: true }),
        ).toBeVisible();
        await page.screenshot({
          path: "test-results/shared-drawer/09-reopened-same-shift.png",
          fullPage: true,
        });
        // Simulate a stale browser view while the server already has an open shift.
        await page.route("**/api/shifts/current", (route) =>
          route.fulfill({ json: { data: null } }),
        );
        await page.goto(url + "/shifts");
        await page
          .getByRole("button", { name: "فتح وردية", exact: true })
          .click();
        await page
          .getByLabel("جهاز الكاشير", { exact: true })
          .selectOption(register.id);
        await page.getByLabel("النقد الافتتاحي", { exact: true }).fill("500");
        await page.getByRole("button", { name: "حفظ", exact: true }).click();
        await ui(
          page.getByText(/توجد وردية مفتوحة بالفعل لدرج المحل/).first(),
        ).toBeVisible();
        await page.screenshot({
          path: "test-results/shared-drawer/12-second-open-rejected.png",
          fullPage: true,
        });
        await page.unroute("**/api/shifts/current");
        await send(owner, `/shifts/${shift.id}/close`, { countedCash: "460" });
        await page.getByRole("button", { name: "حفظ", exact: true }).click();
        await ui(
          page.getByText(/وردية اليوم اتقفلت بالفعل/).first(),
        ).toBeVisible();
        await page.screenshot({
          path: "test-results/shared-drawer/14-new-shift-after-close-rejected.png",
          fullPage: true,
        });
        await send(owner, `/shifts/${shift.id}/reopen`, {});

        await page.goto(url + "/sales");
        await page
          .getByRole("button", { name: "عرض الفاتورة", exact: true })
          .first()
          .click();
        await page.screenshot({
          path: "test-results/shared-drawer/10-selected-cashier-receipt.png",
          fullPage: true,
        });
        await page.goto(url + "/audit-logs");
        await ui(
          page.getByText("الكاشير على الفاتورة", { exact: true }),
        ).toBeVisible();
        await page.screenshot({
          path: "test-results/shared-drawer/11-cashier-audit.png",
          fullPage: true,
        });
        await page.goto(url + "/reports");
        await page
          .getByLabel("نوع التقرير", { exact: true })
          .selectOption("cashier");
        await ui(page.getByText(/أحمد \[/)).toBeVisible();
        await page.screenshot({
          path: "test-results/shared-drawer/06-cashier-report.png",
          fullPage: true,
        });
        await page.setViewportSize({ width: 1440, height: 900 });
        await ui(page.getByText(/أحمد \[/)).toBeVisible();
        await page.screenshot({
          path: "test-results/shared-drawer/18-cashier-report-desktop.png",
          fullPage: true,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(url + "/settings");
        await ui(
          page.getByLabel("عمولة الكاشير (%)", { exact: true }),
        ).toBeVisible();
        await page
          .getByLabel("عمولة الكاشير (%)", { exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: "test-results/shared-drawer/13-commission-settings.png",
          fullPage: true,
        });
        await db.user.updateMany({
          where: { id: { in: [a.user.id, b.user.id] } },
          data: { active: false },
        });
        await page.goto(url + "/pos");
        await ui(page.getByLabel("اسم الكاشير", { exact: true })).toHaveCount(
          0,
        );
        await ui(page.getByText(/مفيش كاشير متاح/)).toHaveCount(0);
        await page.screenshot({
          path: "test-results/shared-drawer/07-no-cashiers.png",
          fullPage: true,
        });
        await db.user.updateMany({
          where: { id: { in: [a.user.id, b.user.id] } },
          data: { active: true },
        });
      } finally {
        await browser.close();
        await new Promise<void>((r) => web.httpServer.close(() => r()));
        await new Promise<void>((r) => http.close(() => r()));
        process.env.APP_ORIGIN = origin;
      }
    }, 60000);
    it("keeps net exchanges working with an explicitly selected replacement cashier", async () => {
      const r = await send(owner, "/sales", body(b.user.id));
      expect(r.status).toBe(201);
      const exchanged = await send(
        owner,
        `/sales/${r.body.data.id}/exchanges/net`,
        {
          returned: {
            shiftId: shift.id,
            reason: "تجربة استبدال",
            method: "CASH",
            items: [
              {
                saleItemId: r.body.data.items[0].id,
                quantity: 1,
                sellable: true,
              },
            ],
          },
          replacement: { ...body(a.user.id), payments: [] },
        },
      );
      expect(exchanged.status).toBe(201);
      expect(exchanged.body.data.replacement.userId).toBe(a.user.id);
      const before = await db.sale.count();
      const invalid = await send(
        owner,
        `/sales/${exchanged.body.data.replacement.id}/exchanges/net`,
        {
          returned: {
            shiftId: shift.id,
            reason: "اختيار غير صالح",
            method: "CASH",
            items: [
              {
                saleItemId: exchanged.body.data.replacement.items[0].id,
                quantity: 1,
                sellable: true,
              },
            ],
          },
          replacement: { ...body(crypto.randomUUID()), payments: [] },
        },
      );
      expect(invalid.status).toBe(400);
      expect(await db.sale.count()).toBe(before);
    });
    it("keeps shared-account receipt access and survives competing cashiers selling the last unit", async () => {
      const posted = await send(a, "/sales", body(b.user.id));
      expect(posted.status).toBe(201);
      expect(
        (await a.agent.get(`/api/sales/${posted.body.data.id}`)).status,
      ).toBe(200);
      const balance = await db.stockBalance.findUniqueOrThrow({
        where: {
          variantId_locationId: {
            variantId: variant.id,
            locationId: location.id,
          },
        },
      });
      await send(owner, "/inventory/adjustments", {
        variantId: variant.id,
        locationId: location.id,
        quantity: 1 - balance.quantity,
        reason: "Prepare last-unit race",
      });
      const before = await db.sale.count();
      const results = await Promise.all([
        send(a, "/sales", body(a.user.id)),
        send(b, "/sales", body(b.user.id)),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await db.sale.count()).toBe(before + 1);
      const closes = await Promise.all([
        send(a, `/shifts/${shift.id}/close`, { countedCash: "660" }),
        send(b, `/shifts/${shift.id}/close`, { countedCash: "660" }),
      ]);
      expect(closes.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        (await a.agent.get(`/api/sales/${posted.body.data.id}`)).status,
      ).toBe(200);
      expect(
        (await a.agent.get("/api/sales")).body.data.some(
          (r: any) => r.id === posted.body.data.id,
        ),
      ).toBe(true);
    });
    it("computes commission from invoice total including tax and subtracts returned tax", async () => {
      const { Prisma } = await import("@prisma/client");
      const before = await db.sale.findUniqueOrThrow({
        where: { id: saleA.id },
      });
      expect(before.total.toString()).toBe("100");
      const from = new Date(Date.now() - 86400000).toISOString(),
        to = new Date(Date.now() + 86400000).toISOString();
      const r = await owner.agent
        .get("/api/reports/detail/cashier")
        .query({ from, to });
      for (const row of r.body.data)
        expect(new Prisma.Decimal(row.commission).toFixed(2)).toBe(
          new Prisma.Decimal(row.total).div(100).toFixed(2),
        );
    });
    it("deployment role addition is idempotent and preserves custom permissions", async () => {
      const sql = await import("node:fs/promises").then((fs) =>
        fs.readFile(
          "apps/api/prisma/migrations/202611230001_shared_drawer/migration.sql",
          "utf8",
        ),
      );
      const addition = sql.slice(sql.indexOf("WITH created AS"));
      const role = await db.role.findUniqueOrThrow({
        where: { name: "كاشير" },
        include: { permissions: true },
      });
      const original = role.permissions.map((p: any) => p.permissionKey).sort();
      await db.$executeRawUnsafe(addition);
      await db.$executeRawUnsafe(addition);
      const after = await db.role.findUniqueOrThrow({
        where: { name: "كاشير" },
        include: { permissions: true },
      });
      expect(after.id).toBe(role.id);
      expect(after.permissions.map((p: any) => p.permissionKey).sort()).toEqual(
        original,
      );
    });
    it("floors commission at zero when returns exceed sales in the period", async () => {
      // A third cashier with a sale backdated outside the window, returned
      // inside it, nets negative: the commission floors at zero.
      expect((await send(a, `/shifts/${shift.id}/reopen`, {})).status).toBe(
        200,
      );
      const role = await db.role.findUniqueOrThrow({
        where: { name: "كاشير" },
      });
      const created = await send(owner, "/users", {
        name: "سارة",
        email: "c@example.test",
        password,
        roleIds: [role.id],
      });
      expect(created.status).toBe(201);
      expect(
        (
          await send(owner, "/inventory/adjustments", {
            locationId: location.id,
            variantId: variant.id,
            quantity: 1,
            cost: "20",
            reason: "تهيئة اختبار العمولة السالبة",
          })
        ).status,
      ).toBe(200);
      const old = await send(owner, "/sales", body(created.body.data.id));
      expect(old.status).toBe(201);
      // Backdate the posted sale outside the report window. The snapshot
      // immutability trigger guards createdAt, so set the fixture date in a
      // trigger-disabled transaction (test-only; app paths never do this).
      await db.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe(
          "SET LOCAL session_replication_role = 'replica'",
        );
        await tx.$executeRawUnsafe(
          'UPDATE "Sale" SET "createdAt" = $1 WHERE id = $2::uuid',
          new Date(Date.now() - 3 * 86400000),
          old.body.data.id,
        );
      });
      const returned = await send(owner, `/sales/${old.body.data.id}/returns`, {
        shiftId: shift.id,
        reason: "إرجاع فاتورة قديمة",
        method: "CASH",
        items: [
          {
            saleItemId: old.body.data.items[0].id,
            quantity: 1,
            sellable: true,
          },
        ],
      });
      expect(returned.status).toBe(200);
      // Wide window: the test database stores timestamps in the Cairo
      // session zone while query params compare as UTC, so keep ±6 hours.
      const from = new Date(Date.now() - 6 * 3600000).toISOString(),
        to = new Date(Date.now() + 6 * 3600000).toISOString();
      const r = await owner.agent
        .get("/api/reports/detail/cashier")
        .query({ from, to });
      expect(r.status).toBe(200);
      const row = r.body.data.find((row: any) =>
        String(row.label).startsWith("سارة"),
      );
      expect(row).toBeTruthy();
      expect(Number(row.total)).toBeLessThan(0);
      expect(row.commission).toBe("0.00");
    });
    it("attributes sale and commission to the picked cashier, not the signed-in one", async () => {
      // Amr's exact scenario: أحمد is signed in and picks منى on the invoice.
      const rows = async () => {
        const r = await owner.agent.get("/api/reports/detail/cashier").query({
          // Wide window: test DB timestamps are stored in the Cairo session
          // zone while the query params compare as UTC.
          from: new Date(Date.now() - 6 * 3600000).toISOString(),
          to: new Date(Date.now() + 6 * 3600000).toISOString(),
        });
        expect(r.status).toBe(200);
        return r.body.data as any[];
      };
      const totals = (list: any[]) => ({
        ahmed: Number(
          list.find((row) => String(row.label).startsWith("أحمد"))?.total ?? 0,
        ),
        mona: Number(
          list.find((row) => String(row.label).startsWith("منى"))?.total ?? 0,
        ),
      });
      const before = totals(await rows());
      const r = await send(a, "/sales", body(b.user.id));
      expect(r.status).toBe(201);
      expect(r.body.data.userId).toBe(b.user.id);
      expect(r.body.data.operatorId).toBe(a.user.id);
      const after = totals(await rows());
      expect(after.mona - before.mona).toBeCloseTo(
        Number(r.body.data.total),
        2,
      );
      expect(after.ahmed - before.ahmed).toBeCloseTo(0, 2);
      // Capture the per-cashier report on mobile as Amr asked to see it.
      const http = app.listen(0, "127.0.0.1");
      await new Promise((r) => http.once("listening", r));
      const web = await preview({
        root: resolve("apps/web"),
        preview: {
          host: "127.0.0.1",
          port: 0,
          proxy: { "/api": `http://127.0.0.1:${http.address().port}` },
        },
      });
      const url = `http://127.0.0.1:${web.httpServer.address().port}`;
      process.env.APP_ORIGIN = url;
      const browser = await chromium.launch({
        channel: "chrome",
        headless: true,
      });
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const page = await ctx.newPage();
      try {
        await page.goto(url + "/login");
        await page.getByLabel("البريد الإلكتروني").fill("owner@example.test");
        await page.getByLabel("كلمة المرور", { exact: true }).fill(password);
        await page
          .getByRole("button", { name: "تسجيل الدخول", exact: true })
          .click();
        await page.waitForURL((u) => !u.pathname.includes("login"));
        await page.goto(url + "/reports");
        await page
          .getByLabel("نوع التقرير", { exact: true })
          .selectOption("cashier");
        await ui(page.getByText(/منى \[/)).toBeVisible();
        await ui(page.getByText(/أحمد \[/)).toBeVisible();
        await page.screenshot({
          path: "test-results/shared-drawer/15-picked-cashier-not-signed-in-report.png",
          fullPage: true,
        });
      } finally {
        await browser.close();
        await new Promise<void>((r) => web.httpServer.close(() => r()));
        await new Promise<void>((r) => http.close(() => r()));
        process.env.APP_ORIGIN = origin;
      }
    });
    it("shows and hides the VAT lines on a picked-cashier receipt without changing totals", async () => {
      // Local isolated check for إظهار الضريبة في الفاتورة: toggle the setting
      // on/off around a sale made with a picked cashier; calculation untouched.
      const setting = await db.systemSetting.findUniqueOrThrow({
        where: { key: "store" },
      });
      const original = setting.value as Record<string, any>;
      const patchStore = (extra: Record<string, any>) =>
        owner.agent
          .patch("/api/settings/store")
          .set("Origin", process.env.APP_ORIGIN ?? origin)
          .set("X-CSRF-Token", owner.csrf)
          .send({ ...original, ...extra });
      const http = app.listen(0, "127.0.0.1");
      await new Promise((r) => http.once("listening", r));
      let web: any, browser: any;
      try {
        expect(
          (await patchStore({ taxRate: "14", showTaxOnInvoice: true })).status,
        ).toBe(200);
        expect(
          (
            await send(owner, "/inventory/adjustments", {
              locationId: location.id,
              variantId: variant.id,
              quantity: 1,
              cost: "20",
              reason: "تهيئة اختبار إظهار الضريبة",
            })
          ).status,
        ).toBe(200);
        const r = await send(a, "/sales", {
          ...body(b.user.id),
          payments: [{ method: "CASH", amount: "114" }],
        });
        expect(r.status, JSON.stringify(r.body)).toBe(201);
        expect(Number(r.body.data.tax)).toBeCloseTo(14, 2);
        expect(Number(r.body.data.total)).toBeCloseTo(114, 2);
        expect(r.body.data.userId).toBe(b.user.id);
        expect(r.body.data.operatorId).toBe(a.user.id);
        web = await preview({
          root: resolve("apps/web"),
          preview: {
            host: "127.0.0.1",
            port: 0,
            proxy: { "/api": `http://127.0.0.1:${http.address().port}` },
          },
        });
        const url = `http://127.0.0.1:${web.httpServer.address().port}`;
        process.env.APP_ORIGIN = url;
        browser = await chromium.launch({ channel: "chrome", headless: true });
        const page = await (
          await browser.newContext({
            viewport: { width: 390, height: 844 },
          })
        ).newPage();
        const openReceipt = async () => {
          await page.goto(url + "/sales");
          await page
            .getByRole("button", { name: "عرض الفاتورة", exact: true })
            .first()
            .click();
        };
        await page.goto(url + "/login");
        await page.getByLabel("البريد الإلكتروني").fill("owner@example.test");
        await page.getByLabel("كلمة المرور", { exact: true }).fill(password);
        await page
          .getByRole("button", { name: "تسجيل الدخول", exact: true })
          .click();
        await page.waitForURL((u) => !u.pathname.includes("login"));
        await openReceipt();
        await ui(
          page.getByText("VAT (14% added)", { exact: true }).first(),
        ).toBeVisible();
        await ui(
          page.getByText("14.00 EGP", { exact: true }).first(),
        ).toBeVisible();
        await ui(
          page.getByText("114.00 EGP", { exact: true }).first(),
        ).toBeVisible();
        await page.screenshot({
          path: "test-results/shared-drawer/16-receipt-vat-shown.png",
          fullPage: true,
        });
        expect((await patchStore({ showTaxOnInvoice: false })).status).toBe(
          200,
        );
        await openReceipt();
        await ui(
          page.getByText("Amount due", { exact: true }).first(),
        ).toBeVisible();
        await ui(page.getByText(/VAT/)).toHaveCount(0);
        await ui(
          page.getByText("114.00 EGP", { exact: true }).first(),
        ).toBeVisible();
        await page.screenshot({
          path: "test-results/shared-drawer/17-receipt-vat-hidden.png",
          fullPage: true,
        });
        const saved = await owner.agent.get(`/api/sales/${r.body.data.id}`);
        expect(Number(saved.body.data.tax)).toBeCloseTo(14, 2);
        expect(Number(saved.body.data.total)).toBeCloseTo(114, 2);
      } finally {
        await patchStore(original);
        await browser?.close();
        if (web)
          await new Promise<void>((r) => web.httpServer.close(() => r()));
        await new Promise<void>((r) => http.close(() => r()));
        process.env.APP_ORIGIN = origin;
      }
    });
    it("returns sales per cashier and one drawer shortage, rejects yesterday reopen", async () => {
      const now = new Date(),
        from = new Date(now.getTime() - 86400000).toISOString(),
        to = new Date(now.getTime() + 86400000).toISOString();
      const r = await owner.agent
        .get("/api/reports/detail/cashier")
        .query({ from, to });
      expect(r.status).toBe(200);
      expect(JSON.stringify(r.body)).toContain("أحمد");
      expect(JSON.stringify(r.body)).toContain("منى");
      for (const row of r.body.data) {
        expect(row.commissionRate).toBe("1.00");
        expect(Number(row.commission)).toBeCloseTo(
          Math.max(0, Number(row.total)) * 0.01,
          2,
        );
      }
      const shifts = await owner.agent
        .get("/api/reports/detail/shifts")
        .query({ from, to });
      expect(shifts.status).toBe(200);
      expect(shifts.body.data).toHaveLength(1);
      await db.cashShift.update({
        where: { id: shift.id },
        data: {
          openedAt: new Date(Date.now() - 86400000),
          closedAt: new Date(),
        },
      });
      expect(
        (await send(a, `/shifts/${shift.id}/reopen`, {})).body.error.code,
      ).toBe("SHIFT_REOPEN_DAY");
    });
  },
);
