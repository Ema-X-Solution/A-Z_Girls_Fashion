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
describe.sequential("administrative self-only cashier selection", () => {
  let manager: any,
    other: any,
    cashier: any,
    staff: any,
    shift: any,
    variant: any;
  it("prepares isolated accounts, open drawer and stock", async () => {
    const create = async (name: string, email: string, roleName: string) => {
      const role = await db.role.findUniqueOrThrow({
        where: { name: roleName },
      });
      const r = await send(owner, "/users", {
        name,
        email,
        password,
        roleIds: [role.id],
      });
      expect(r.status).toBe(201);
      return login(email);
    };
    manager = await create("مدير الاختبار", "manager@example.test", "MANAGER");
    other = await create("مدير آخر", "other@example.test", "MANAGER");
    cashier = await create("كاشير الاختبار", "cashier@example.test", "كاشير");
    staff = await create("موظف عادي", "staff@example.test", "CASHIER");
    shift = (
      await send(owner, "/shifts/open", {
        registerId: register.id,
        openingCash: "0",
      })
    ).body.data;
    expect(shift.id).toBeTruthy();
    const category = await db.category.create({
      data: { name: "اختبار المدير" },
    });
    const product = await send(owner, "/products", {
      nameAr: "منتج الاختبار",
      sku: "MANAGER-TEST",
      categoryId: category.id,
      variants: [
        { sku: "MANAGER-S", barcode: "98981234", price: "100", cost: "20" },
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
  const sale = (id?: string) => ({
    shiftId: shift.id,
    cashierId: id,
    items: [{ variantId: variant.id, quantity: 1 }],
    payments: [{ method: "CASH", amount: "100" }],
  });
  it("limits legacy and paginated lists, searches and selected lookups to the current administrator", async () => {
    for (const actor of [owner, manager, other]) {
      for (const suffix of [
        "",
        "?offset=0",
        `?offset=0&selected=${other.user.id}`,
        "?q=مدير&offset=0",
      ]) {
        const r = await actor.agent.get(`/api/sales/cashiers${suffix}`);
        expect(r.status).toBe(200);
        const ids = r.body.data.map((u: any) => u.id);
        for (const account of [owner, manager, other]) {
          if (account.user.id !== actor.user.id)
            expect(ids).not.toContain(account.user.id);
        }
        if (!suffix.includes("q=")) expect(ids).toContain(actor.user.id);
        if (actor.user.id !== other.user.id && suffix.includes("selected="))
          expect(r.body.selected).toBeNull();
      }
    }
    for (const actor of [cashier, staff]) {
      const r = await actor.agent.get(
        `/api/sales/cashiers?offset=0&selected=${manager.user.id}`,
      );
      expect(r.status).toBe(200);
      expect(r.body.data.map((u: any) => u.id)).toEqual([cashier.user.id]);
      expect(r.body.selected).toBeNull();
    }
  });
  it("lets OWNER and MANAGER sell under their own names while retaining operator identity", async () => {
    for (const actor of [owner, manager]) {
      const r = await send(actor, "/sales", sale());
      expect(r.status).toBe(201);
      expect(r.body.data.userId).toBe(actor.user.id);
      expect(r.body.data.operatorId).toBe(actor.user.id);
    }
  });
  it("accepts explicit administrative self-selection and exchange without a cashier", async () => {
    const r = await send(manager, "/sales", sale(manager.user.id));
    expect(r.status).toBe(201);
    const exchanged = await send(
      manager,
      `/sales/${r.body.data.id}/exchanges/net`,
      {
        returned: {
          shiftId: shift.id,
          reason: "Manager local test",
          method: "CASH",
          items: [
            {
              saleItemId: r.body.data.items[0].id,
              quantity: 1,
              sellable: true,
            },
          ],
        },
        replacement: { ...sale(), payments: [] },
      },
    );
    expect(exchanged.status).toBe(201);
    expect(exchanged.body.data.replacement.userId).toBe(manager.user.id);
    expect(exchanged.body.data.replacement.operatorId).toBe(manager.user.id);
  });
  it("rejects another administrator, staff self-selection, inactive and forged IDs without writes", async () => {
    const count = await db.sale.count();
    for (const [actor, id] of [
      [owner, manager.user.id],
      [manager, owner.user.id],
      [cashier, manager.user.id],
      [staff, staff.user.id],
      [manager, crypto.randomUUID()],
    ]) {
      const r = await send(actor, "/sales", sale(id));
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe("CASHIER_INVALID");
    }
    await db.user.update({
      where: { id: cashier.user.id },
      data: { active: false },
    });
    expect((await send(manager, "/sales", sale(cashier.user.id))).status).toBe(
      400,
    );
    await db.user.update({
      where: { id: cashier.user.id },
      data: { active: true },
    });
    for (const actor of [staff, cashier]) {
      const missing = await send(actor, "/sales", sale());
      expect(missing.status).toBe(400);
      expect(missing.body.error.code).toBe("CASHIER_REQUIRED");
    }
    expect(await db.sale.count()).toBe(count);
  });
  it("preserves assigned cashier sales and administrator-issued cashier sales", async () => {
    for (const actor of [cashier, staff, manager]) {
      const r = await send(actor, "/sales", sale(cashier.user.id));
      expect(r.status).toBe(201);
      expect(r.body.data.userId).toBe(cashier.user.id);
      expect(r.body.data.operatorId).toBe(actor.user.id);
    }
  });
  it("hides cashier selection in the actual manager payment box with no assigned cashier", async () => {
    await db.user.update({
      where: { id: cashier.user.id },
      data: { active: false },
    });
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
      channel: process.env.BROWSER_CHANNEL ?? "chrome",
      headless: true,
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1080 },
      });
      await page.goto(url + "/login");
      await page.getByLabel("البريد الإلكتروني").fill("manager@example.test");
      await page.getByLabel("كلمة المرور", { exact: true }).fill(password);
      await page
        .getByRole("button", { name: "تسجيل الدخول", exact: true })
        .click();
      await page.waitForURL((u) => !u.pathname.includes("login"));
      await page.goto(url + "/pos");
      const select = page.getByLabel("اسم الكاشير", { exact: true });
      await ui(select).toHaveCount(0);
      await ui(page.getByText(/مفيش كاشير متاح/)).toHaveCount(0);
      await page.reload();
      await ui(select).toHaveCount(0);
      await page
        .getByRole("heading", { name: "طريقة الدفع" })
        .scrollIntoViewIfNeeded();
      await mkdir("test-results/manager-cashier", { recursive: true });
      await page.screenshot({
        path: "test-results/manager-cashier/payment-box.png",
      });
    } finally {
      await browser.close();
      await new Promise<void>((r) => web.httpServer.close(() => r()));
      await new Promise<void>((r) => http.close(() => r()));
      process.env.APP_ORIGIN = origin;
    }
  });
});
