import { beforeAll, afterAll, describe, it, expect } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import request from "supertest";
import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import { chromium, expect as browserExpect, type Page } from "@playwright/test";
import { preview } from "vite";
import { createServer as createSocketServer } from "node:net";
import { registerCompletionTests } from "./completion-scenarios";
const origin = "http://localhost:5173",
  password = randomBytes(24).toString("hex");
let pg: EmbeddedPostgres,
  db: PrismaClient,
  app: Express,
  owner: any,
  cashier: any,
  manager: any,
  branch: any,
  location: any,
  register: any,
  shift: any,
  variant: any,
  product: any,
  supplier: any,
  purchase: any,
  sale: any;
let pgStarted = false;
let pgPort = 55439;
const availablePort = () =>
  new Promise<number>((resolvePort) => {
    const socket = createSocketServer();
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address() as { port: number };
      socket.close(() => resolvePort(address.port));
    });
  });
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
async function openSidebarPage(page: Page, name: string) {
  const link = page
    .locator(".sidebar")
    .getByRole("link", { name, exact: true, includeHidden: true });
  if ((await link.count()) === 0) {
    await page.getByRole("link", { name, exact: true }).click();
    return;
  }
  if (!(await link.isVisible())) {
    const group = await link.evaluate((el) =>
      el.closest("[data-nav-group]")?.getAttribute("data-nav-group"),
    );
    if (!group) throw new Error(`Sidebar destination unavailable: ${name}`);
    await page.locator(`[data-nav-group="${group}"] > button`).click();
  }
  await link.click();
}
async function pickPosCustomer(page: Page, phone = "01012340001") {
  const input = page.getByRole("combobox", {
    name: "رقم العميل أو الاسم",
    exact: true,
  });
  await input.fill(phone);
  const option = page
    .getByRole("listbox", { name: "نتائج بحث العملاء", exact: true })
    .getByRole("option")
    .first();
  const add = page.getByRole("button", {
    name: "إضافة العميل واختياره",
    exact: true,
  });
  await browserExpect(option.or(add)).toBeVisible();
  if (await option.isVisible()) await option.click();
  else await add.click();
  await browserExpect(page.locator(".customer-picker-selected")).toBeVisible();
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
async function resetFixtureQuota() {
  const { apiRateLimiter } = await import("../apps/api/src/app.js");
  apiRateLimiter.resetKey("127.0.0.1");
  apiRateLimiter.resetKey("::ffff:127.0.0.1");
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
  db = (await import("../apps/api/src/db.js")).db;
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
  branch = await db.branch.findFirstOrThrow();
  location = await db.stockLocation.findFirstOrThrow();
  register = await db.register.findFirstOrThrow();
}, 180000);
afterAll(async () => {
  await db?.$disconnect();
  if (pgStarted) await pg.stop();
}, 180000);
describe.sequential("real PostgreSQL retail workflows", () => {
  it("enforces authentication and CSRF", async () => {
    expect((await request(app).get("/api/products")).status).toBe(401);
    expect(
      (await owner.agent.post("/api/categories").send({ name: "invalid" }))
        .status,
    ).toBe(403);
  });
  it("owner creates a manager and cashier with database roles", async () => {
    const roles = await db.role.findMany();
    for (const [name, email, role] of [
      ["Manager", "manager@example.test", "MANAGER"],
      ["Cashier", "cashier@example.test", "CASHIER"],
    ]) {
      const r = await send(owner, "/users", {
        name,
        email,
        password,
        roleIds: [roles.find((v) => v.name === role)!.id],
      });
      expect(r.status).toBe(201);
      expect(r.body.data.passwordHash).toBeUndefined();
    }
    manager = await login("manager@example.test");
    cashier = await login("cashier@example.test");
    expect((await send(cashier, "/users", {})).status).toBe(403);
    expect((await send(manager, "/roles", {})).status).toBe(403);
  });
  it("looks up all customers by phone, accepts optional names and resolves aliases once for POS users", async () => {
    const records = Array.from({ length: 55 }, (_, i) => ({
      name: `Many lookup ${i}`,
      phone: `0117000${String(i).padStart(4, "0")}`,
    }));
    await db.customer.createMany({ data: records });
    const formatted = await db.customer.create({
      data: { name: "Formatted legacy phone", phone: "+20 10 69017890" },
    });
    for (const q of [
      "6901",
      "0178",
      "٦٩٠١٧٨٩٠",
      "201069017890",
      "01069017890",
      "+2010",
    ]) {
      const result = await cashier.agent.get(
        `/api/customers?q=${encodeURIComponent(q)}`,
      );
      expect(result.status).toBe(200);
      expect(
        result.body.data.some((customer: any) => customer.id === formatted.id),
      ).toBe(true);
    }
    const names = await cashier.agent.get(
      "/api/customers?q=Many%20lookup&limit=10&offset=50",
    );
    expect(names.status).toBe(200);
    expect(names.body.total).toBe(55);
    expect(names.body.data).toHaveLength(5);
    expect(names.body.data[0].notes).toBeUndefined();
    for (const q of ["01170000054", "+20 11 70000054", "٠١١٧٠٠٠٠٠٥٤"]) {
      const result = await cashier.agent.get(
        `/api/customers?q=${encodeURIComponent(q)}`,
      );
      expect(result.status).toBe(200);
      expect(result.body.data).toHaveLength(1);
      expect(result.body.data[0].phone).toBe("01170000054");
    }
    const variants = ["01260000001", "+20 12 60000001", "٠١٢٦٠٠٠٠٠٠١"];
    const resolved = await Promise.all(
      variants.map((phone) => send(cashier, "/customers/resolve", { phone })),
    );
    expect(resolved.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(resolved.map((r) => r.body.data.id)).size).toBe(1);
    const c = resolved[0]!.body.data;
    expect(c.name).toBe("");
    expect(c.phone).toBe("+201260000001");
    expect(await db.customer.count({ where: { phone: c.phone } })).toBe(1);
    expect(
      await db.auditLog.count({
        where: { action: "CUSTOMER_CREATE", reference: c.id },
      }),
    ).toBe(1);
    expect(
      (await send(owner, "/customers", { phone: "01260000001" })).status,
    ).toBe(409);
    expect(
      (await send(cashier, "/customers", { phone: "01260000003" })).status,
    ).toBe(403);
    expect(
      (await send(cashier, "/customers/resolve", { phone: "010" })).status,
    ).toBe(400);
    expect(
      (
        await send(cashier, "/customers/resolve", {
          phone: "01260000003",
          notes: "Not permitted",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await cashier.agent
          .post("/api/customers/resolve")
          .set("Origin", process.env.APP_ORIGIN ?? origin)
          .send({ phone: "01260000003" })
      ).status,
    ).toBe(403);
    expect(
      (await cashier.agent.get(`/api/customers/${c.id}`)).body.data,
    ).toEqual(c);
    const required = await send(cashier, "/sales", {
      requireCustomer: true,
      shiftId: crypto.randomUUID(),
      items: [{ variantId: crypto.randomUUID(), quantity: 1 }],
      payments: [{ method: "CASH", amount: "0" }],
    });
    expect(required.status).toBe(400);
    expect(required.body.error.code).toBe("CUSTOMER_REQUIRED");
  });
  it("creates products, flexible variants and unique generated barcodes", async () => {
    const category = await db.category.findFirstOrThrow();
    const r = await send(manager, "/products", {
      nameAr: "فستان اختبار",
      sku: "DRESS-TEST",
      categoryId: category.id,
      variants: [
        {
          sku: "DRESS-PINK-6",
          price: "100.00",
          cost: "40.00",
          options: { المقاس: "6", اللون: "وردي" },
        },
        {
          sku: "DRESS-BLACK-8",
          price: "125",
          cost: "45",
          options: { المقاس: "8", اللون: "أسود" },
        },
      ],
    });
    expect(r.status).toBe(201);
    product = r.body.data;
    variant = product.variants[0];
    expect(variant.barcode).toMatch(/^20\d{10}$/);
    const duplicate = await send(manager, `/products/${product.id}/variants`, {
      sku: "OTHER",
      barcode: variant.barcode,
      price: "1",
    });
    expect(duplicate.status).toBe(409);
    const lookup = await cashier.agent.get(
      `/api/barcodes/${variant.barcode}/lookup`,
    );
    expect(lookup.status).toBe(200);
    expect(lookup.body.data.cost).toBeUndefined();
  });
  it("uploads, deduplicates and removes product images with update permission and CSRF", async () => {
    const bytes = await readFile("apps/web/public/brand/az-logo.jpg");
    const dataUrl = `data:image/jpeg;base64,${bytes.toString("base64")}`;
    const path = `/products/${product.id}/image`;
    expect((await send(cashier, path, { dataUrl })).status).toBe(403);
    expect(
      (
        await manager.agent
          .post(`/api${path}`)
          .set("Origin", origin)
          .send({ dataUrl })
      ).status,
    ).toBe(403);
    for (const bad of [
      "https://example.test/image.jpg",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:image/png;base64," + bytes.toString("base64"),
      "data:image/jpeg;base64," + Buffer.alloc(140001, 255).toString("base64"),
    ]) {
      expect((await send(manager, path, { dataUrl: bad })).status).toBe(400);
    }
    const before = await db.brandAsset.count();
    const uploaded = await send(manager, path, { dataUrl });
    expect(uploaded.status).toBe(200);
    const imageUrl = uploaded.body.data.imageUrl;
    expect(imageUrl).toMatch(/^\/api\/brand-assets\/[a-f0-9]{64}$/);
    expect((await send(manager, path, { dataUrl })).body.data.imageUrl).toBe(
      imageUrl,
    );
    expect(await db.brandAsset.count()).toBe(before + 1);
    const asset = await request(app).get(imageUrl);
    expect(asset.status).toBe(200);
    expect(asset.headers["content-type"]).toContain("image/jpeg");
    expect(Buffer.from(asset.body)).toEqual(bytes);
    expect(
      (await cashier.agent.get(`/api/products/${product.id}`)).body.data
        .imageUrl,
    ).toBe(imageUrl);
    expect(
      (await cashier.agent.get("/api/products?q=DRESS-TEST")).body.data[0]
        .imageUrl,
    ).toBe(imageUrl);
    expect(
      (
        await send(manager, `/products/${crypto.randomUUID()}/image`, {
          dataUrl,
        })
      ).status,
    ).toBe(404);
    expect(
      (await send(manager, path, { dataUrl: null })).body.data.imageUrl,
    ).toBeNull();
    expect(
      (await db.product.findUniqueOrThrow({ where: { id: product.id } }))
        .imageUrl,
    ).toBeNull();
    expect(
      await db.auditLog.count({
        where: { action: "PRODUCT_IMAGE_UPDATED", reference: product.id },
      }),
    ).toBe(3);
  });
  it("creates products with optional images atomically and rejects invalid images without creating products", async () => {
    await resetFixtureQuota();
    const category = await db.category.findFirstOrThrow();
    const input = {
      nameAr: "منتج بصورة اختيارية",
      sku: "IMAGE-CREATE",
      categoryId: category.id,
      variants: [{ sku: "IMAGE-CREATE-V1", price: "10", cost: "2" }],
    };
    const bytes = await readFile("apps/web/public/brand/az-logo.jpg");
    const dataUrl = `data:image/jpeg;base64,${bytes.toString("base64")}`;
    expect(
      (await send(cashier, "/products", { ...input, imageDataUrl: dataUrl }))
        .status,
    ).toBe(403);
    const count = await db.product.count();
    expect(
      (await send(manager, "/products", { ...input, imageDataUrl: "invalid" }))
        .status,
    ).toBe(400);
    expect(await db.product.count()).toBe(count);
    const assets = await db.brandAsset.count();
    const created = await send(manager, "/products", {
      ...input,
      imageDataUrl: dataUrl,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.imageUrl).toMatch(
      /^\/api\/brand-assets\/[a-f0-9]{64}$/,
    );
    expect(
      (
        await db.product.findUniqueOrThrow({
          where: { id: created.body.data.id },
        })
      ).imageUrl,
    ).toBe(created.body.data.imageUrl);
    expect(await db.brandAsset.count()).toBe(assets);
    const plain = await send(manager, "/products", {
      ...input,
      sku: "NO-IMAGE-CREATE",
      variants: [{ sku: "NO-IMAGE-V1", price: "10" }],
    });
    expect(plain.status).toBe(201);
    expect(plain.body.data.imageUrl).toBeNull();
    expect(
      (
        await send(manager, "/products", {
          ...input,
          sku: "FAILED-IMAGE-CREATE",
          variants: [{ sku: "IMAGE-CREATE-V1", price: "10" }],
          imageDataUrl: dataUrl,
        })
      ).status,
    ).toBe(409);
    expect(
      await db.product.count({ where: { sku: "FAILED-IMAGE-CREATE" } }),
    ).toBe(0);
  });
  it("receives partial purchases and tracks weighted average cost", async () => {
    const s = await send(manager, "/suppliers", { name: "Test supplier" });
    supplier = s.body.data;
    const p = await send(manager, "/purchases", {
      supplierId: supplier.id,
      locationId: location.id,
      items: [{ variantId: variant.id, quantity: 3, unitCost: "40" }],
    });
    expect(p.status).toBe(201);
    purchase = p.body.data;
    expect(
      (
        await send(manager, `/purchases/${purchase.id}/receive`, {
          items: [{ purchaseItemId: purchase.items[0].id, quantity: 1 }],
        })
      ).status,
    ).toBe(409);
    expect(
      (await send(manager, `/purchases/${purchase.id}/approve`, {})).status,
    ).toBe(200);
    const key = crypto.randomUUID(),
      body = { items: [{ purchaseItemId: purchase.items[0].id, quantity: 1 }] };
    const received = await send(
      manager,
      `/purchases/${purchase.id}/receive`,
      body,
      key,
    );
    expect(received.status).toBe(200);
    expect(
      (await send(manager, `/purchases/${purchase.id}/receive`, body, key)).body
        .data.id,
    ).toBe(received.body.data.id);
    expect(
      (
        await send(manager, `/purchases/${purchase.id}/receive`, {
          items: [{ purchaseItemId: purchase.items[0].id, quantity: 2 }],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await db.stockBalance.findUniqueOrThrow({
          where: {
            variantId_locationId: {
              variantId: variant.id,
              locationId: location.id,
            },
          },
        })
      ).quantity,
    ).toBe(3);
  });
  it("opens a shift and prevents a second active shift", async () => {
    const r = await send(cashier, "/shifts/open", {
      registerId: register.id,
      openingCash: "200",
    });
    expect(r.status).toBe(201);
    shift = r.body.data;
    expect(
      (
        await send(owner, "/shifts/open", {
          registerId: register.id,
          openingCash: "0",
        })
      ).status,
    ).toBe(409);
  });
  it("checks discount limits and rolls back failed checkout", async () => {
    const body = {
      shiftId: shift.id,
      items: [{ variantId: variant.id, quantity: 1 }],
      payments: [{ method: "CASH", amount: "100" }],
      discount: "1",
    };
    expect((await send(cashier, "/sales", body)).status).toBe(403);
    expect(
      (
        await send(cashier, "/sales", {
          ...body,
          discount: "0",
          payments: [{ method: "CASH", amount: "99" }],
        })
      ).status,
    ).toBe(400);
    expect(await db.sale.count()).toBe(0);
    expect((await db.stockBalance.findFirstOrThrow()).quantity).toBe(3);
  });
  it("checkout is atomic, idempotent, cash-correct and hides costs", async () => {
    const body = {
        shiftId: shift.id,
        items: [{ variantId: variant.id, quantity: 1 }],
        payments: [{ method: "CASH", amount: "120" }],
      },
      key = crypto.randomUUID();
    const replies = await Promise.all([
      send(cashier, "/sales", body, key),
      send(cashier, "/sales", body, key),
    ]);
    expect(replies.map((r) => r.status)).toEqual([201, 201]);
    expect(replies[0]!.body.data.id).toBe(replies[1]!.body.data.id);
    sale = replies[0]!.body.data;
    expect(sale.change).toBe("20");
    expect(sale.items[0].unitCost).toBeUndefined();
    expect(await db.sale.count()).toBe(1);
    expect(
      (await send(cashier, "/sales", { ...body, notes: "changed" }, key))
        .status,
    ).toBe(409);
    const persisted = await db.saleItem.findFirstOrThrow();
    expect(persisted.unitCost.toString()).toBe("40");
    expect((await db.stockBalance.findFirstOrThrow()).quantity).toBe(2);
  });
  it("repeated refunds post once and cannot exceed original quantity", async () => {
    const reg = await db.register.create({
      data: {
        name: "Manager register",
        branchId: branch.id,
        locationId: location.id,
      },
    });
    const r = await send(manager, "/shifts/open", {
        registerId: reg.id,
        openingCash: "500",
      }),
      managerShift = r.body.data;
    const body = {
        shiftId: managerShift.id,
        reason: "Wrong size",
        method: "CASH",
        items: [{ saleItemId: sale.items[0].id, quantity: 1, sellable: true }],
      },
      key = crypto.randomUUID();
    const replies = await Promise.all([
      send(manager, `/sales/${sale.id}/returns`, body, key),
      send(manager, `/sales/${sale.id}/returns`, body, key),
    ]);
    expect(replies.map((r) => r.status)).toEqual([200, 200]);
    expect(replies[0]!.body.data.id).toBe(replies[1]!.body.data.id);
    expect(await db.saleReturn.count()).toBe(1);
    expect(
      (await send(manager, `/sales/${sale.id}/returns`, body)).status,
    ).toBe(409);
    expect((await db.stockBalance.findFirstOrThrow()).quantity).toBe(3);
  });
  it("two cashiers cannot both sell the final unit", async () => {
    await send(manager, "/inventory/adjustments", {
      variantId: variant.id,
      locationId: location.id,
      quantity: -2,
      reason: "Prepare last item",
    });
    const reg = await db.register.create({
      data: {
        name: "Owner register",
        branchId: branch.id,
        locationId: location.id,
      },
    });
    const r = await send(owner, "/shifts/open", {
      registerId: reg.id,
      openingCash: "0",
    });
    const body = {
      items: [{ variantId: variant.id, quantity: 1 }],
      payments: [{ method: "CARD", amount: "100" }],
    };
    const results = await Promise.all([
      send(cashier, "/sales", { ...body, shiftId: shift.id }),
      send(owner, "/sales", { ...body, shiftId: r.body.data.id }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await db.stockBalance.findFirstOrThrow()).quantity).toBe(0);
  });
  it("simultaneous adjustments preserve ledger and balance", async () => {
    const body = {
      variantId: variant.id,
      locationId: location.id,
      quantity: 1,
      reason: "Count correction",
      cost: "60",
    };
    const results = await Promise.all([
      send(manager, "/inventory/adjustments", body),
      send(manager, "/inventory/adjustments", body),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const b = await db.stockBalance.findFirstOrThrow();
    expect(b.quantity).toBe(2);
    expect(b.averageCost.toString()).toBe("60");
    const movements = await db.stockMovement.aggregate({
      _sum: { quantity: true },
      where: { variantId: variant.id },
    });
    expect(movements._sum.quantity).toBe(b.quantity);
  });
  it("cash expenses affect drawer while bank expenses do not", async () => {
    const before = (
      await db.cashMovement.aggregate({
        where: { shiftId: shift.id },
        _sum: { amount: true },
      })
    )._sum.amount!;
    expect(
      (
        await send(manager, "/expenses", {
          category: "إنترنت",
          amount: "10",
          method: "BANK",
          description: "Bank payment",
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await send(cashier, "/expenses", {
          category: "أخرى",
          amount: "10",
          method: "CASH",
          description: "No permission",
          shiftId: shift.id,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await db.cashMovement.aggregate({
          where: { shiftId: shift.id },
          _sum: { amount: true },
        })
      )._sum.amount!.equals(before),
    ).toBe(true);
  });
  it("stock count rejects a stale cutoff", async () => {
    const count = await send(manager, "/inventory/stock-counts", {
      locationId: location.id,
    });
    expect(count.status).toBe(201);
    await manager.agent
      .patch(`/api/inventory/stock-counts/${count.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", manager.csrf)
      .send({ items: [{ variantId: variant.id, actual: 2 }] });
    await send(manager, "/inventory/adjustments", {
      variantId: variant.id,
      locationId: location.id,
      quantity: 1,
      reason: "New receipt",
      cost: "60",
    });
    expect(
      (
        await send(
          manager,
          `/inventory/stock-counts/${count.body.data.id}/approve`,
          {},
        )
      ).status,
    ).toBe(409);
  });
  it("financial reports respect permission and historical costs", async () => {
    const ownerReport = await owner.agent.get("/api/reports/dashboard");
    expect(ownerReport.status).toBe(200);
    expect(ownerReport.body.data.costOfGoodsSold).toBe("40.00");
    expect(ownerReport.body.data.netSales).toBe("100.00");
    const cashierReport = await cashier.agent.get("/api/reports/dashboard");
    expect(cashierReport.body.data.costOfGoodsSold).toBeUndefined();
    expect(cashierReport.body.data.netProfit).toBeUndefined();
    expect((await cashier.agent.get("/api/audit-logs")).status).toBe(403);
  });
  it("closes shift with immutable reconciliation", async () => {
    const moves = await db.cashMovement.aggregate({
      where: { shiftId: shift.id },
      _sum: { amount: true },
    });
    const expected = 200 + Number(moves._sum.amount ?? 0);
    const body = { countedCash: String(expected), notes: "Counted" },
      key = crypto.randomUUID();
    const r = await send(cashier, `/shifts/${shift.id}/close`, body, key);
    expect(r.status).toBe(200);
    expect(r.body.data.difference).toBe("0");
    expect(
      (await send(cashier, `/shifts/${shift.id}/close`, body, key)).body.data
        .id,
    ).toBe(shift.id);
    expect(
      (
        await send(cashier, "/sales", {
          shiftId: shift.id,
          items: [{ variantId: variant.id, quantity: 1 }],
          payments: [{ method: "CASH", amount: "100" }],
        })
      ).status,
    ).toBe(409);
  });
  it("browser completes cashier scan, sale, receipt, return and shift closure", async () => {
    const http = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => http.once("listening", r));
    const apiPort = (http.address() as { port: number }).port;
    const vite = await preview({
      root: resolve("apps/web"),
      preview: {
        host: "127.0.0.1",
        port: await availablePort(),
        strictPort: true,
        proxy: { "/api": `http://127.0.0.1:${apiPort}` },
      },
    });
    const browserOrigin = `http://127.0.0.1:${(vite.httpServer!.address() as { port: number }).port}`;
    process.env.APP_ORIGIN = browserOrigin;
    const browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL ?? "msedge",
      headless: true,
      timeout: 15000,
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    page.on("pageerror", (error) =>
      console.info(`Browser runtime error: ${error.message}`),
    );
    try {
      await mkdir("test-results", { recursive: true });
      await page.goto(browserOrigin, { waitUntil: "domcontentloaded" });
      await page.screenshot({ path: "test-results/login.png", fullPage: true });
      await page.getByLabel("البريد الإلكتروني").fill("cashier@example.test");
      await page.getByLabel("كلمة المرور", { exact: true }).fill(password);
      await page
        .getByRole("button", { name: "تسجيل الدخول", exact: true })
        .click();
      await browserExpect(
        page.getByRole("heading", { name: /أهلاً/ }),
      ).toBeVisible();
      await page.screenshot({
        path: "test-results/dashboard.png",
        fullPage: true,
      });
      await openSidebarPage(page, "ورديات الكاشير");
      await page
        .getByRole("button", { name: "فتح وردية", exact: true })
        .click();
      await page
        .getByLabel("جهاز الكاشير", { exact: true })
        .selectOption(register.id);
      await page.getByLabel("النقد الافتتاحي").fill("100");
      await page.getByRole("button", { name: "حفظ", exact: true }).click();
      await browserExpect(page.getByRole("dialog")).toHaveCount(0);
      await openSidebarPage(page, "نقطة البيع");
      await page
        .getByRole("textbox", { name: "مسح الباركود" })
        .fill(variant.barcode);
      await page.getByRole("textbox", { name: "مسح الباركود" }).press("Enter");
      await browserExpect(page.locator(".cart-line")).toHaveCount(1);
      await page
        .getByLabel("المبلغ المستلم (فارغ = المبلغ المستحق)")
        .fill("100");
      await page.screenshot({ path: "test-results/pos.png", fullPage: true });
      await pickPosCustomer(page);
      await page
        .getByRole("button", { name: "إتمام البيع", exact: true })
        .click();
      await browserExpect(page.getByRole("dialog")).toBeVisible();
      await browserExpect(page.locator(".receipt-preview")).toContainText(
        "فستان اختبار",
      );
      await page.screenshot({
        path: "test-results/receipt.png",
        fullPage: true,
      });
      await browserExpect(page.locator(".receipt-preview")).toContainText(
        "Cashier",
      );
      const invoice = (await page
        .locator(".receipt-preview")
        .getAttribute("data-sequence"))!;
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "إلغاء", exact: true })
        .click();
      await page
        .getByRole("button", { name: "تسجيل الخروج", exact: true })
        .click();
      await page.getByLabel("البريد الإلكتروني").fill("manager@example.test");
      await page.getByLabel("كلمة المرور", { exact: true }).fill(password);
      await page
        .getByRole("button", { name: "تسجيل الدخول", exact: true })
        .click();
      await browserExpect(
        page.getByRole("heading", { name: /أهلاً/ }),
      ).toBeVisible();
      await openSidebarPage(page, "المبيعات");
      await page.getByPlaceholder("ابحث برقم الفاتورة").fill(invoice);
      await page.getByRole("button", { name: "عرض الفاتورة" }).click();
      await page.getByRole("button", { name: "إرجاع منتجات" }).click();
      await page.locator(".return-line input[type=number]").fill("1");
      await page.getByLabel("السبب", { exact: true }).fill("المقاس غير مناسب");
      await page.getByRole("button", { name: "اعتماد المرتجع" }).click();
      await browserExpect(page.getByRole("dialog")).toContainText(
        "إيصال المرتجع",
      );
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "إلغاء", exact: true })
        .click();
      await browserExpect(page.getByRole("dialog")).toHaveCount(0);
      await page
        .getByRole("button", { name: "تسجيل الخروج", exact: true })
        .click();
      await page.getByLabel("البريد الإلكتروني").fill("cashier@example.test");
      await page.getByLabel("كلمة المرور", { exact: true }).fill(password);
      await page
        .getByRole("button", { name: "تسجيل الدخول", exact: true })
        .click();
      await browserExpect(
        page.getByRole("heading", { name: /أهلاً/ }),
      ).toBeVisible();
      await openSidebarPage(page, "ورديات الكاشير");
      await page
        .getByRole("button", { name: "إغلاق الوردية", exact: true })
        .click();
      await page.getByLabel("النقد الفعلي", { exact: true }).fill("200");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "حفظ", exact: true })
        .click();
      await browserExpect(page.getByRole("dialog")).toHaveCount(0);
      await openSidebarPage(page, "طباعة الباركود");
      await page
        .getByRole("checkbox", { name: "اختيار DRESS-PINK-6", exact: true })
        .check();
      await page
        .getByRole("spinbutton", {
          name: "عدد ملصقات DRESS-PINK-6",
          exact: true,
        })
        .fill("3");
      await page
        .getByRole("button", { name: "معاينة الملصقات", exact: true })
        .click();
      await browserExpect(
        page.locator(".barcode-preview .retail-label"),
      ).toHaveCount(3);
      await browserExpect(
        page.locator(".barcode-preview .label-number").first(),
      ).toHaveText(variant.barcode);
      await page.screenshot({
        path: "test-results/barcode-preview.png",
        fullPage: true,
      });
      await page.emulateMedia({ media: "print" });
      await browserExpect(page.locator("#az-label-print-root")).toBeVisible();
      await browserExpect(page.locator("#root")).not.toBeVisible();
      const labelSize = await page
        .locator("#az-label-print-root .retail-label")
        .first()
        .evaluate((el) => ({
          width: el.getBoundingClientRect().width,
          height: el.getBoundingClientRect().height,
        }));
      expect(labelSize.width).toBeCloseTo((50 * 96) / 25.4, 0);
      expect(labelSize.height).toBeCloseTo((30 * 96) / 25.4, 0);
      await page
        .locator("#az-label-print-root .retail-label")
        .first()
        .screenshot({ path: "test-results/barcode-label.png" });
      const thermalPdf = await page.pdf({
        path: "test-results/barcode-50x30.pdf",
        preferCSSPageSize: true,
        printBackground: true,
      });
      expect(
        (thermalPdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? [])
          .length,
      ).toBe(3);
      await page.emulateMedia({ media: "screen" });
      await page.getByLabel("نوع الورق", { exact: true }).selectOption("a4");
      await page.emulateMedia({ media: "print" });
      const a4Pdf = await page.pdf({
        path: "test-results/barcode-a4.pdf",
        preferCSSPageSize: true,
        printBackground: true,
      });
      expect(
        (a4Pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length,
      ).toBe(1);
      await page.emulateMedia({ media: "screen" });
      await page
        .getByRole("button", { name: "تسجيل الخروج", exact: true })
        .click();
      await page.getByLabel("البريد الإلكتروني").fill("manager@example.test");
      await page.getByLabel("كلمة المرور", { exact: true }).fill(password);
      await page
        .getByRole("button", { name: "تسجيل الدخول", exact: true })
        .click();
      await browserExpect(
        page.getByRole("heading", { name: /أهلاً/ }),
      ).toBeVisible();
      await openSidebarPage(page, "الموردون");
      await page
        .getByRole("button", { name: "إضافة مورد", exact: true })
        .click();
      await page
        .getByLabel("اسم المورد", { exact: true })
        .fill("Browser supplier");
      await page
        .getByLabel("الرصيد الافتتاحي المستحق للمورد", { exact: true })
        .fill("100");
      await page
        .getByRole("button", { name: "حفظ المورد", exact: true })
        .click();
      await browserExpect(page.getByRole("dialog")).toHaveCount(0);
      await page
        .getByRole("textbox", { name: "بحث الموردين", exact: true })
        .fill("Browser supplier");
      await openSidebarPage(page, "كشف الحساب والفواتير");
      await page
        .getByRole("button", { name: "تسجيل سداد", exact: true })
        .click();
      await page.getByLabel("مبلغ السداد", { exact: true }).fill("30");
      await page
        .getByLabel("طريقة السداد", { exact: true })
        .selectOption("BANK");
      await page
        .getByRole("button", { name: "تأكيد السداد", exact: true })
        .click();
      await browserExpect(page.getByRole("dialog")).toHaveCount(0);
      await browserExpect(page.locator(".stat-card.featured")).toContainText(
        new Intl.NumberFormat("ar-EG", {
          style: "currency",
          currency: "EGP",
        }).format(70),
      );
      await page.screenshot({
        path: "test-results/supplier-statement.png",
        fullPage: true,
      });
      await page.goto(`${browserOrigin}/suppliers`);
      await page
        .getByRole("textbox", { name: "بحث الموردين", exact: true })
        .fill("Test supplier");
      await openSidebarPage(page, "كشف الحساب والفواتير");
      await page
        .getByRole("button", { name: "فواتير المورد", exact: true })
        .click();
      await page
        .getByRole("button", { name: "تفاصيل الفاتورة", exact: true })
        .first()
        .click();
      await openSidebarPage(page, "باركود هذه الدفعة");
      await browserExpect(
        page.getByRole("spinbutton", {
          name: "عدد ملصقات DRESS-PINK-6",
          exact: true,
        }),
      ).toHaveValue("2");
      await page.goto(`${browserOrigin}/suppliers/${supplier.id}`);
      await page
        .getByRole("button", { name: "فواتير المورد", exact: true })
        .click();
      await page
        .getByRole("button", { name: "تفاصيل الفاتورة", exact: true })
        .first()
        .click();
      await page
        .getByRole("button", { name: "مرتجع للمورد", exact: true })
        .click();
      await page.getByRole("dialog").locator("input[type=number]").fill("1");
      await page
        .getByLabel("سبب مرتجع المشتريات", { exact: true })
        .fill("تجربة مرتجع المشتريات");
      await page
        .getByRole("button", { name: "اعتماد مرتجع المشتريات", exact: true })
        .click();
      await browserExpect(page.getByRole("dialog")).toHaveCount(0);
      await page
        .getByRole("button", { name: "مرتجعات المشتريات", exact: true })
        .click();
      await browserExpect(page.locator("table")).toContainText(
        "تجربة مرتجع المشتريات",
      );
      await page.screenshot({
        path: "test-results/purchase-return.png",
        fullPage: true,
      });
    } catch (error) {
      await page
        .screenshot({
          path: "test-results/browser-failure.png",
          fullPage: true,
        })
        .catch(() => {});
      throw error;
    } finally {
      await browser.close();
      vite.httpServer.closeAllConnections();
      await new Promise<void>((r) => vite.httpServer.close(() => r()));
      await new Promise<void>((r) => http.close(() => r()));
      process.env.APP_ORIGIN = origin;
    }
  }, 60000);
  it("database prevents ledger alteration", async () => {
    const movement = await db.stockMovement.findFirstOrThrow();
    await expect(
      db.stockMovement.update({
        where: { id: movement.id },
        data: { reason: "tampered" },
      }),
    ).rejects.toThrow();
    expect(await db.auditLog.count()).toBeGreaterThan(10);
  });
  it("exchanges roll back on replacement failure and commit idempotently", async () => {
    const managerShift = await db.cashShift.findFirstOrThrow({
      where: { userId: manager.user.id, closedAt: null },
    });
    const original = await send(manager, "/sales", {
      shiftId: managerShift.id,
      items: [{ variantId: variant.id, quantity: 1 }],
      payments: [{ method: "CASH", amount: "100" }],
    });
    expect(original.status).toBe(201);
    const sold = original.body.data,
      before = await db.stockBalance.findFirstOrThrow({
        where: { variantId: variant.id },
      });
    const returned = {
      shiftId: managerShift.id,
      reason: "Exchange size",
      method: "CASH",
      items: [{ saleItemId: sold.items[0].id, quantity: 1, sellable: true }],
    };
    const replacement = {
      shiftId: managerShift.id,
      items: [{ variantId: product.variants[1].id, quantity: 1 }],
      payments: [{ method: "CASH", amount: "125" }],
    };
    expect(
      (
        await send(manager, `/sales/${sold.id}/exchanges`, {
          returned,
          replacement,
        })
      ).status,
    ).toBe(409);
    expect(
      (await db.saleItem.findUniqueOrThrow({ where: { id: sold.items[0].id } }))
        .returned,
    ).toBe(0);
    expect(
      (
        await db.stockBalance.findFirstOrThrow({
          where: { variantId: variant.id },
        })
      ).quantity,
    ).toBe(before.quantity);
    const body = {
        returned,
        replacement: {
          ...replacement,
          items: [{ variantId: variant.id, quantity: 1 }],
          payments: [{ method: "CASH", amount: "100" }],
        },
      },
      key = crypto.randomUUID();
    const exchanged = await send(
      manager,
      `/sales/${sold.id}/exchanges`,
      body,
      key,
    );
    expect(exchanged.status).toBe(200);
    expect(exchanged.body.data.replacement.items[0].unitCost).toBeUndefined();
    expect(exchanged.body.data.returned.items[0].cost).toBeUndefined();
    expect(
      (await send(manager, `/sales/${sold.id}/exchanges`, body, key)).body.data
        .replacement.id,
    ).toBe(exchanged.body.data.replacement.id);
    expect(
      (
        await db.stockBalance.findFirstOrThrow({
          where: { variantId: variant.id },
        })
      ).quantity,
    ).toBe(before.quantity);
  });
  it("cash expenses debit the creating cashier shift exactly once", async () => {
    const managerShift = await db.cashShift.findFirstOrThrow({
        where: { userId: manager.user.id, closedAt: null },
      }),
      before = await db.cashMovement.aggregate({
        where: { shiftId: managerShift.id },
        _sum: { amount: true },
      }),
      key = crypto.randomUUID(),
      body = {
        category: "تغليف",
        amount: "5",
        method: "CASH",
        description: "Cash packaging",
        shiftId: managerShift.id,
      };
    const r = await send(manager, "/expenses", body, key);
    expect(r.status).toBe(201);
    expect((await send(manager, "/expenses", body, key)).body.data.id).toBe(
      r.body.data.id,
    );
    const after = await db.cashMovement.aggregate({
      where: { shiftId: managerShift.id },
      _sum: { amount: true },
    });
    expect(before._sum.amount!.minus(after._sum.amount!).toString()).toBe("5");
  });
  it("prepares barcode labels from server prices without exposing costs or changing stock", async () => {
    const before = await db.stockMovement.count();
    const result = await send(cashier, "/barcodes/print-labels", {
      items: [{ variantId: variant.id, quantity: 3 }],
      price: "0",
    });
    expect(result.status).toBe(200);
    expect(result.body.data.items[0]).toMatchObject({
      barcode: variant.barcode,
      price: "100.00",
      quantity: 3,
    });
    expect(result.body.data.items[0].cost).toBeUndefined();
    expect(await db.stockMovement.count()).toBe(before);
    expect(
      (
        await send(manager, "/barcodes/print-labels", {
          items: [{ variantId: variant.id, quantity: 501 }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send(manager, "/barcodes/print-labels", {
          items: [
            { variantId: variant.id, quantity: 1 },
            { variantId: variant.id, quantity: 1 },
          ],
        })
      ).status,
    ).toBe(400);
  });
  let accountSupplier: any,
    accountVariant: any,
    accountInvoice: any,
    accountItem: any;
  it("creates supplier invoice accruals from receiving and reconciles opening balances", async () => {
    const s = await send(manager, "/suppliers", {
      name: "Account supplier",
      openingBalance: "25",
    });
    expect(s.status).toBe(201);
    accountSupplier = s.body.data;
    const category = await db.category.findFirstOrThrow();
    const p = await send(manager, "/products", {
      nameAr: "حقيبة اختبار الحسابات",
      sku: "ACCOUNT-BAG",
      categoryId: category.id,
      variants: [{ sku: "ACCOUNT-BAG-ONE", price: "90" }],
    });
    expect(p.status).toBe(201);
    accountVariant = p.body.data.variants[0];
    const purchase = await send(manager, "/purchases", {
      supplierId: accountSupplier.id,
      locationId: location.id,
      items: [{ variantId: accountVariant.id, quantity: 3, unitCost: "40" }],
    });
    await send(manager, `/purchases/${purchase.body.data.id}/approve`, {});
    const received = await send(
      manager,
      `/purchases/${purchase.body.data.id}/receive`,
      {
        items: [
          { purchaseItemId: purchase.body.data.items[0].id, quantity: 3 },
        ],
      },
    );
    expect(received.status).toBe(200);
    const invoices = await manager.agent.get(
      `/api/suppliers/${accountSupplier.id}/invoices`,
    );
    expect(invoices.body.total).toBe(1);
    accountInvoice = invoices.body.data[0];
    const detail = await manager.agent.get(
      `/api/supplier-invoices/${accountInvoice.id}`,
    );
    expect(detail.status).toBe(200);
    accountItem = detail.body.data.receipt.items[0];
    expect(accountItem.lineTotal).toBe("120");
    const statement = await manager.agent.get(
      `/api/suppliers/${accountSupplier.id}/statement`,
    );
    expect(statement.body.data.summary).toMatchObject({
      openingBalance: "25.00",
      invoiced: "120.00",
      balance: "145.00",
    });
    const labels = await manager.agent.get(
      `/api/barcodes/receipts/${received.body.data.id}/items`,
    );
    expect(labels.status).toBe(200);
    expect(labels.body.data.quantities[accountVariant.id]).toBe(3);
    expect(labels.body.data.products[0].variants[0].cost).toBeUndefined();
    expect(
      (
        await cashier.agent.get(
          `/api/suppliers/${accountSupplier.id}/statement`,
        )
      ).status,
    ).toBe(403);
  });
  it("records supplier bank payments once and rejects overpayment", async () => {
    const before = await db.cashMovement.count(),
      key = crypto.randomUUID(),
      body = { amount: "40", method: "BANK", reference: "BANK-REF-1" };
    const results = await Promise.all([
      send(manager, `/suppliers/${accountSupplier.id}/payments`, body, key),
      send(manager, `/suppliers/${accountSupplier.id}/payments`, body, key),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201]);
    expect(results[0]!.body.data.id).toBe(results[1]!.body.data.id);
    expect(await db.cashMovement.count()).toBe(before);
    expect(
      (
        await send(manager, `/suppliers/${accountSupplier.id}/payments`, {
          amount: "106",
          method: "BANK",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await manager.agent.get(
          `/api/suppliers/${accountSupplier.id}/statement`,
        )
      ).body.data.summary.balance,
    ).toBe("105.00");
  });
  it("supplier returns credit original cost, deduct stock and reject excess quantities", async () => {
    const key = crypto.randomUUID(),
      body = {
        reason: "Return to supplier",
        items: [{ receiptItemId: accountItem.id, quantity: 1 }],
      };
    const results = await Promise.all([
      send(
        manager,
        `/supplier-invoices/${accountInvoice.id}/returns`,
        body,
        key,
      ),
      send(
        manager,
        `/supplier-invoices/${accountInvoice.id}/returns`,
        body,
        key,
      ),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results[0]!.body.data.id).toBe(results[1]!.body.data.id);
    expect(results[0]!.body.data.total).toBe("40");
    const balance = await db.stockBalance.findFirstOrThrow({
      where: { variantId: accountVariant.id },
    });
    expect(balance.quantity).toBe(2);
    expect(
      (
        await send(manager, `/supplier-invoices/${accountInvoice.id}/returns`, {
          reason: "Too many",
          items: [{ receiptItemId: accountItem.id, quantity: 3 }],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await manager.agent.get(
          `/api/suppliers/${accountSupplier.id}/statement`,
        )
      ).body.data.summary.balance,
    ).toBe("65.00");
  });
  it("rolls back supplier returns without available stock and reports valuation variance", async () => {
    await send(manager, "/inventory/adjustments", {
      variantId: accountVariant.id,
      locationId: location.id,
      quantity: -2,
      reason: "Remove for count",
    });
    const body = {
      reason: "Supplier return",
      items: [{ receiptItemId: accountItem.id, quantity: 1 }],
    };
    expect(
      (
        await send(
          manager,
          `/supplier-invoices/${accountInvoice.id}/returns`,
          body,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await db.purchaseReceiptItem.findUniqueOrThrow({
          where: { id: accountItem.id },
        })
      ).returned,
    ).toBe(1);
    await send(manager, "/inventory/adjustments", {
      variantId: accountVariant.id,
      locationId: location.id,
      quantity: 2,
      reason: "Count with updated valuation",
      cost: "60",
    });
    const before = await owner.agent.get("/api/reports/dashboard");
    const result = await send(
      manager,
      `/supplier-invoices/${accountInvoice.id}/returns`,
      body,
    );
    expect(result.status).toBe(200);
    expect(result.body.data.items[0].inventoryCost).toBeUndefined();
    expect(
      (
        await db.purchaseReturnItem.findFirstOrThrow({
          where: { returnId: result.body.data.id },
        })
      ).inventoryCost.toString(),
    ).toBe("60");
    const after = await owner.agent.get("/api/reports/dashboard");
    expect(
      Number(after.body.data.purchaseReturnVariance) -
        Number(before.body.data.purchaseReturnVariance),
    ).toBe(20);
    expect(
      Number(before.body.data.netProfit) - Number(after.body.data.netProfit),
    ).toBe(20);
  });
  it("supplier cash payments debit the correct open shift exactly once", async () => {
    const shift = await db.cashShift.findFirstOrThrow({
        where: { userId: manager.user.id, closedAt: null },
      }),
      before = await db.cashMovement.aggregate({
        where: { shiftId: shift.id },
        _sum: { amount: true },
      }),
      body = { amount: "25", method: "CASH", shiftId: shift.id },
      key = crypto.randomUUID();
    const first = await send(
      manager,
      `/suppliers/${accountSupplier.id}/payments`,
      body,
      key,
    );
    expect(first.status).toBe(201);
    expect(
      (
        await send(
          manager,
          `/suppliers/${accountSupplier.id}/payments`,
          body,
          key,
        )
      ).body.data.id,
    ).toBe(first.body.data.id);
    const after = await db.cashMovement.aggregate({
      where: { shiftId: shift.id },
      _sum: { amount: true },
    });
    expect(before._sum.amount!.minus(after._sum.amount!).toString()).toBe("25");
    expect(
      (
        await manager.agent.get(
          `/api/suppliers/${accountSupplier.id}/statement`,
        )
      ).body.data.summary.balance,
    ).toBe("0.00");
  });
  it("concurrent supplier payments cannot exceed the remaining balance", async () => {
    const supplier = await send(manager, "/suppliers", {
        name: "Concurrent account",
        openingBalance: "100",
      }),
      body = { amount: "70", method: "BANK" };
    const responses = await Promise.all([
      send(manager, `/suppliers/${supplier.body.data.id}/payments`, body),
      send(manager, `/suppliers/${supplier.body.data.id}/payments`, body),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(
      (
        await manager.agent.get(
          `/api/suppliers/${supplier.body.data.id}/statement`,
        )
      ).body.data.summary.balance,
    ).toBe("30.00");
  });
  it("concurrent supplier returns preserve eligible quantity and account reconciliation", async () => {
    const body = {
      reason: "Final returned unit",
      items: [{ receiptItemId: accountItem.id, quantity: 1 }],
    };
    const responses = await Promise.all([
      send(manager, `/supplier-invoices/${accountInvoice.id}/returns`, body),
      send(manager, `/supplier-invoices/${accountInvoice.id}/returns`, body),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const statement = await manager.agent.get(
      `/api/suppliers/${accountSupplier.id}/statement`,
    );
    expect(statement.body.data.summary.balance).toBe("-40.00");
    expect(Number(statement.body.data.entries.at(-1).balance)).toBe(-40);
    expect(statement.body.data.total).toBe(7);
    await expect(
      db.supplierInvoice.update({
        where: { id: accountInvoice.id },
        data: { total: "1" },
      }),
    ).rejects.toThrow();
  });
  it("net exchanges collect only the price difference and preserve internal credit", async () => {
    const shift = await db.cashShift.findFirstOrThrow({
        where: { userId: manager.user.id, closedAt: null },
      }),
      category = await db.category.findFirstOrThrow();
    const product = await send(manager, "/products", {
      nameAr: "أصناف استبدال",
      sku: "NET-EX",
      categoryId: category.id,
      variants: [
        { sku: "NET-100", price: "100" },
        { sku: "NET-125", price: "125" },
        { sku: "NET-80", price: "80" },
      ],
    });
    expect(product.status).toBe(201);
    const variants = product.body.data.variants;
    for (const v of variants)
      expect(
        (
          await send(manager, "/inventory/adjustments", {
            variantId: v.id,
            locationId: location.id,
            quantity: 5,
            reason: "Exchange opening stock",
            cost: "40",
          })
        ).status,
      ).toBe(200);
    for (const [replacementSku, difference] of [
      ["NET-100", "0"],
      ["NET-125", "25"],
      ["NET-80", "-20"],
    ]) {
      const original = await send(manager, "/sales", {
        shiftId: shift.id,
        items: [
          {
            variantId: variants.find((v: any) => v.sku === "NET-100").id,
            quantity: 1,
          },
        ],
        payments: [{ method: "CASH", amount: "100" }],
      });
      expect(original.status).toBe(201);
      const before = await db.cashMovement.aggregate({
          where: { shiftId: shift.id },
          _sum: { amount: true },
        }),
        body = {
          returned: {
            shiftId: shift.id,
            reason: "Exchange test",
            method: "CASH",
            items: [
              {
                saleItemId: original.body.data.items[0].id,
                quantity: 1,
                sellable: true,
              },
            ],
          },
          replacement: {
            shiftId: shift.id,
            items: [
              {
                variantId: variants.find((v: any) => v.sku === replacementSku)
                  .id,
                quantity: 1,
              },
            ],
            payments:
              difference === "25"
                ? [
                    {
                      method: "CARD",
                      amount: "25",
                      cardBrand: "Visa",
                      authorizationCode: "EX-25",
                    },
                  ]
                : [],
          },
        },
        key = crypto.randomUUID();
      const results = await Promise.all([
        send(
          manager,
          `/sales/${original.body.data.id}/exchanges/net`,
          body,
          key,
        ),
        send(
          manager,
          `/sales/${original.body.data.id}/exchanges/net`,
          body,
          key,
        ),
      ]);
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      expect(results[0]!.body.data.id).toBe(results[1]!.body.data.id);
      const exchange = results[0]!.body.data;
      expect(exchange.difference).toBe(difference);
      expect(
        exchange.replacement.payments.some(
          (p: any) => p.method === "EXCHANGE_CREDIT",
        ),
      ).toBe(true);
      expect(exchange.returned.refundAmount).toBe(
        difference === "-20" ? "20" : "0",
      );
      expect(exchange.replacement.items[0].unitCost).toBeUndefined();
      const after = await db.cashMovement.aggregate({
        where: { shiftId: shift.id },
        _sum: { amount: true },
      });
      expect(after._sum.amount!.minus(before._sum.amount!).toString()).toBe(
        difference === "-20" ? "-20" : "0",
      );
    }
  });
  it("partial VAT refunds preserve every tax cent and printed snapshots remain immutable", async () => {
    const saved = await db.systemSetting.findUniqueOrThrow({
      where: { key: "store" },
    });
    try {
      await db.systemSetting.update({
        where: { key: "store" },
        data: {
          value: {
            ...(saved.value as Record<string, any>),
            taxRate: "14",
            taxMode: "INCLUSIVE",
          },
        },
      });
      const category = await db.category.findFirstOrThrow(),
        shift = await db.cashShift.findFirstOrThrow({
          where: { userId: owner.user.id, closedAt: null },
        });
      const product = await send(owner, "/products", {
        nameAr: "منتج ضريبة جزئية",
        sku: "VAT-PARTIAL",
        categoryId: category.id,
        variants: [{ sku: "VAT-PARTIAL-ONE", price: "33.33" }],
      });
      const variantId = product.body.data.variants[0].id;
      await send(owner, "/inventory/adjustments", {
        variantId,
        locationId: location.id,
        quantity: 3,
        reason: "VAT opening stock",
        cost: "10",
      });
      const result = await send(owner, "/sales", {
        shiftId: shift.id,
        items: [{ variantId, quantity: 3 }],
        payments: [
          {
            method: "CARD",
            amount: "99.99",
            cardBrand: "Visa",
            authorizationCode: "VAT-CENTS",
            cardLast4: "4321",
          },
        ],
      });
      expect(result.status).toBe(201);
      const sale = result.body.data;
      expect(sale.tax).toBe("12.28");
      expect(sale.receiptNumber).toMatch(/^INV-\d{4}-\d{5,}$/);
      let tax = 0;
      for (let i = 0; i < 3; i++) {
        const returned = await send(owner, `/sales/${sale.id}/returns`, {
          shiftId: shift.id,
          reason: "Partial VAT return",
          method: "CARD",
          items: [
            { saleItemId: sale.items[0].id, quantity: 1, sellable: true },
          ],
        });
        expect(returned.status).toBe(200);
        tax += Math.round(Number(returned.body.data.items[0].tax) * 100);
      }
      expect(tax).toBe(1228);
      const stored = await db.saleItem.findUniqueOrThrow({
        where: { id: sale.items[0].id },
      });
      expect(stored.refundedTax.toString()).toBe("12.28");
      await db.systemSetting.update({
        where: { key: "store" },
        data: {
          value: {
            ...(saved.value as Record<string, any>),
            name: "New store heading",
            taxRate: "10",
            taxMode: "EXCLUSIVE",
          },
        },
      });
      const reread = await owner.agent.get(`/api/sales/${sale.id}`);
      expect(reread.body.data.receiptSnapshot).toEqual(sale.receiptSnapshot);
      expect(reread.body.data.tax).toBe("12.28");
      expect(reread.body.data.taxMode).toBe("INCLUSIVE");
      await expect(
        db.sale.update({ where: { id: sale.id }, data: { total: "1" } }),
      ).rejects.toThrow();
    } finally {
      await db.systemSetting.update({
        where: { key: "store" },
        data: { value: saved.value as any },
      });
    }
  });
  it("enforces defect-only return rules from the original sale snapshot", async () => {
    const category = await db.category.findFirstOrThrow(),
      shift = await db.cashShift.findFirstOrThrow({
        where: { userId: manager.user.id, closedAt: null },
      }),
      p = await send(manager, "/products", {
        nameAr: "صنف لعيب الصناعة فقط",
        sku: "DEFECT-ONLY",
        categoryId: category.id,
        returnRule: "DEFECT_ONLY",
        variants: [{ sku: "DEFECT-ONE", price: "50" }],
      });
    const v = p.body.data.variants[0];
    await send(manager, "/inventory/adjustments", {
      variantId: v.id,
      locationId: location.id,
      quantity: 1,
      reason: "Defect test stock",
      cost: "20",
    });
    const sold = await send(manager, "/sales", {
      shiftId: shift.id,
      items: [{ variantId: v.id, quantity: 1 }],
      payments: [{ method: "CASH", amount: "50" }],
    });
    expect(sold.status).toBe(201);
    await manager.agent
      .patch(`/api/products/${p.body.data.id}`)
      .set("Origin", process.env.APP_ORIGIN ?? origin)
      .set("X-CSRF-Token", manager.csrf)
      .send({ returnRule: "STANDARD" });
    const body = {
      shiftId: shift.id,
      reason: "Defect test",
      method: "CASH",
      items: [
        {
          saleItemId: sold.body.data.items[0].id,
          quantity: 1,
          sellable: false,
        },
      ],
    };
    expect(
      (await send(manager, `/sales/${sold.body.data.id}/returns`, body)).status,
    ).toBe(403);
    expect(
      (
        await send(manager, `/sales/${sold.body.data.id}/returns`, {
          ...body,
          reasonType: "MANUFACTURING_DEFECT",
        })
      ).status,
    ).toBe(200);
  });
  it("recovers checkout results, scopes attempts to the actor, and cancels delayed submissions atomically", async () => {
    const ownerShift = await db.cashShift.findFirstOrThrow({
      where: { userId: owner.user.id, closedAt: null },
    });
    const recoveryProduct = await send(owner, "/products", {
      nameAr: "اختبار استرجاع البيع",
      sku: "RECOVERY-TEST",
      categoryId: product.categoryId,
      variants: [{ sku: "RECOVERY-ONE", price: "30" }],
    });
    expect(recoveryProduct.status).toBe(201);
    const v = recoveryProduct.body.data.variants[0];
    expect(
      (
        await send(owner, "/inventory/adjustments", {
          variantId: v.id,
          locationId: location.id,
          quantity: 8,
          reason: "Recovery test stock",
        })
      ).status,
    ).toBe(200);
    const body = {
      shiftId: ownerShift.id,
      items: [{ variantId: v.id, quantity: 1 }],
      payments: [{ method: "CASH", amount: "100000" }],
    };
    // Quote authoritative tender to avoid changing any fixture product prices.
    const quoted = await send(owner, "/sales/quote", body);
    expect(quoted.status).toBe(200);
    expect(quoted.body.data.items).toEqual([
      { variantId: v.id, unitPrice: "30.00" },
    ]);
    expect(
      (await request(app).get(`/api/checkout-attempts/${crypto.randomUUID()}`))
        .status,
    ).toBe(401);
    body.payments[0].amount = quoted.body.data.total;
    const key = crypto.randomUUID();
    const unknown = await owner.agent.get(`/api/checkout-attempts/${key}`);
    expect(unknown.body.data.status).toBe("UNKNOWN");
    const sold = await send(owner, "/sales", body, key);
    expect(sold.status).toBe(201);
    const status = await owner.agent.get(`/api/checkout-attempts/${key}`);
    expect(status.body.data).toEqual({
      status: "COMPLETED",
      saleId: sold.body.data.id,
    });
    expect(
      (await manager.agent.get(`/api/checkout-attempts/${key}`)).body.data
        .status,
    ).toBe("UNKNOWN");
    const completedCancel = await send(
      owner,
      `/checkout-attempts/${key}/cancel`,
      {},
    );
    expect(completedCancel.body.data.saleId).toBe(sold.body.data.id);
    const cancelledKey = crypto.randomUUID(),
      before = await db.sale.count();
    expect(
      (await send(owner, `/checkout-attempts/${cancelledKey}/cancel`, {})).body
        .data.status,
    ).toBe("CANCELLED");
    const delayed = await send(owner, "/sales", body, cancelledKey);
    expect(delayed.status).toBe(409);
    expect(delayed.body.error.code).toBe("CHECKOUT_CANCELLED");
    expect(await db.sale.count()).toBe(before);
    // Either ordering is valid; cancellation and checkout must agree on one outcome.
    const racingKey = crypto.randomUUID();
    const [posted, cancelled] = await Promise.all([
      send(owner, "/sales", body, racingKey),
      send(owner, `/checkout-attempts/${racingKey}/cancel`, {}),
    ]);
    if (posted.status === 201)
      expect(cancelled.body.data).toEqual({
        status: "COMPLETED",
        saleId: posted.body.data.id,
      });
    else {
      expect(posted.body.error.code).toBe("CHECKOUT_CANCELLED");
      expect(cancelled.body.data.status).toBe("CANCELLED");
    }
    expect((await owner.agent.get("/api/checkout-attempts/short")).status).toBe(
      400,
    );
  });
  it("binds discount approvals to the requester/cart, rechecks authority, and consumes approval atomically", async () => {
    const requesterShift = await db.cashShift.findFirstOrThrow({
      where: { userId: manager.user.id, closedAt: null },
    });
    const created = await send(owner, "/products", {
      nameAr: "اختبار موافقة الخصم",
      sku: "APPROVAL-TEST",
      categoryId: product.categoryId,
      variants: [{ sku: "APPROVAL-ONE", price: "100" }],
    });
    expect(created.status).toBe(201);
    const v = created.body.data.variants[0];
    await send(owner, "/inventory/adjustments", {
      variantId: v.id,
      locationId: location.id,
      quantity: 8,
      reason: "Approval test stock",
    });
    const body = {
      shiftId: requesterShift.id,
      items: [{ variantId: v.id, quantity: 1 }],
      discount: "25",
      payments: [{ method: "CASH", amount: "75" }],
      notes: "طلب محدد",
    };
    const requested = await send(manager, "/discount-approvals", {
      sale: body,
      reason: "خصم استثنائي لاختبار الصلاحيات",
    });
    expect(requested.status).toBe(201);
    const approval = requested.body.data;
    expect(approval.input.payments[0].amount).toBe("0");
    expect(
      (await cashier.agent.get(`/api/discount-approvals/${approval.id}`))
        .status,
    ).toBe(403);
    expect(
      (
        await send(manager, `/discount-approvals/${approval.id}/decision`, {
          decision: "APPROVED",
          note: "موافقة ذاتية",
        })
      ).body.error.code,
    ).toBe("SELF_APPROVAL");
    expect(
      (
        await send(cashier, `/discount-approvals/${approval.id}/decision`, {
          decision: "APPROVED",
          note: "بدون صلاحية",
        })
      ).status,
    ).toBe(403);
    await db.user.update({
      where: { id: owner.user.id },
      data: { discountLimit: 20 },
    });
    expect(
      (
        await send(owner, `/discount-approvals/${approval.id}/decision`, {
          decision: "APPROVED",
          note: "أعلى من حدي",
        })
      ).body.error.code,
    ).toBe("APPROVER_LIMIT");
    await db.user.update({
      where: { id: owner.user.id },
      data: { discountLimit: 100 },
    });
    expect(
      (
        await send(owner, `/discount-approvals/${approval.id}/decision`, {
          decision: "APPROVED",
          note: "موافقة بعد مراجعة السبب",
        })
      ).status,
    ).toBe(200);
    const approved = { ...body, discountApprovalId: approval.id };
    expect((await send(manager, "/sales/quote", approved)).status).toBe(200);
    expect(
      (
        await send(manager, "/sales/quote", {
          ...approved,
          notes: "سلة مختلفة",
        })
      ).body.error.code,
    ).toBe("DISCOUNT_APPROVAL_CHANGED");
    await db.productVariant.update({
      where: { id: v.id },
      data: { price: 101 },
    });
    expect(
      (await send(manager, "/sales/quote", approved)).body.error.code,
    ).toBe("DISCOUNT_APPROVAL_CHANGED");
    await db.productVariant.update({
      where: { id: v.id },
      data: { price: 100 },
    });
    await db.user.update({
      where: { id: owner.user.id },
      data: { discountLimit: 1 },
    });
    expect(
      (await send(manager, "/sales/quote", approved)).body.error.code,
    ).toBe("DISCOUNT_APPROVAL_INVALID");
    await db.user.update({
      where: { id: owner.user.id },
      data: { discountLimit: 100 },
    });
    expect(
      (
        await send(manager, "/sales", {
          ...approved,
          payments: [{ method: "CASH", amount: "1" }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await db.discountApproval.findUniqueOrThrow({
          where: { id: approval.id },
        })
      ).status,
    ).toBe("APPROVED");
    const before = await db.sale.count(),
      keys = [crypto.randomUUID(), crypto.randomUUID()];
    const results = await Promise.all(
      keys.map((key) => send(manager, "/sales", approved, key)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await db.sale.count()).toBe(before + 1);
    const winner = results.findIndex((r) => r.status === 201);
    expect(
      (await send(manager, "/sales", approved, keys[winner])).body.data.id,
    ).toBe(results[winner].body.data.id);
    const consumed = await db.discountApproval.findUniqueOrThrow({
      where: { id: approval.id },
    });
    expect(consumed.status).toBe("CONSUMED");
    expect(consumed.consumedSaleId).toBe(results[winner].body.data.id);
    expect(
      await db.auditLog.count({
        where: {
          action: "DISCOUNT_APPROVAL_USED",
          reference: consumed.consumedSaleId!,
        },
      }),
    ).toBe(1);
    await expect(
      db.discountApproval.update({
        where: { id: approval.id },
        data: { reason: "تغيير تاريخي" },
      }),
    ).rejects.toThrow();
    const expired = await db.discountApproval.create({
      data: {
        requesterId: approval.requesterId,
        shiftId: approval.shiftId,
        input: approval.input,
        fingerprint: approval.fingerprint,
        reason: "Expired fixture",
        subtotal: 100,
        discount: 25,
        total: 75,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    expect(
      (
        await send(owner, `/discount-approvals/${expired.id}/decision`, {
          decision: "APPROVED",
          note: "طلب منتهي",
        })
      ).body.error.code,
    ).toBe("APPROVAL_CLOSED");
    const rejected = await send(manager, "/discount-approvals", {
      sale: body,
      reason: "طلب مرفوض",
    });
    expect(
      (
        await send(
          owner,
          `/discount-approvals/${rejected.body.data.id}/decision`,
          { decision: "REJECTED", note: "سبب الخصم غير مناسب" },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await send(manager, "/sales/quote", {
          ...body,
          discountApprovalId: rejected.body.data.id,
        })
      ).status,
    ).toBe(403);
  });
  it("applies automatic offers without cashier override and freezes bundle return policy", async () => {
    const ownerShift = await db.cashShift.findFirstOrThrow({
        where: { userId: owner.user.id, closedAt: null },
      }),
      managerShift = await db.cashShift.findFirstOrThrow({
        where: { userId: manager.user.id, closedAt: null },
      });
    const created = await send(owner, "/products", {
      nameAr: "أصناف العروض",
      sku: "PROMO-TEST",
      categoryId: product.categoryId,
      variants: [
        { sku: "PROMO-A", price: "100" },
        { sku: "PROMO-B", price: "80" },
      ],
    });
    expect(created.status).toBe(201);
    const [a, b] = created.body.data.variants;
    for (const v of [a, b])
      await send(owner, "/inventory/adjustments", {
        variantId: v.id,
        locationId: location.id,
        quantity: 20,
        reason: "Campaign fixture stock",
      });
    const campaign = {
      name: "اشتري 2 والثالثة هدية",
      type: "BUY_X_GET_Y",
      productIds: [created.body.data.id],
      percent: "0",
      buyQuantity: 2,
      getQuantity: 1,
      startsAt: new Date(Date.now() - 60000).toISOString(),
      endsAt: new Date(Date.now() + 86400000).toISOString(),
      active: true,
    };
    expect((await send(cashier, "/promotions", campaign)).status).toBe(403);
    expect((await send(manager, "/promotions", campaign)).body.error.code).toBe(
      "PROMOTION_LIMIT",
    );
    const bundle = await send(owner, "/promotions", campaign),
      percentage = await send(owner, "/promotions", {
        ...campaign,
        name: "خصم 25 بالمئة",
        type: "PERCENT",
        percent: "25",
      });
    expect(bundle.status).toBe(201);
    expect(percentage.status).toBe(201);
    const quote = {
      shiftId: managerShift.id,
      items: [
        { variantId: a.id, quantity: 2 },
        { variantId: b.id, quantity: 1 },
      ],
      payments: [{ method: "CASH", amount: "200" }],
    };
    const priced = await send(manager, "/sales/quote", quote);
    expect(priced.status).toBe(200);
    expect(Number(priced.body.data.total)).toBe(200);
    expect(priced.body.data.promotion.id).toBe(bundle.body.data.id);
    const input = {
      ...quote,
      shiftId: managerShift.id,
      discount: "10",
      discountType: "PERCENT",
      payments: [{ method: "CASH", amount: "180" }],
    };
    const manualApproval = await send(manager, "/discount-approvals", {
      sale: input,
      reason: "خصم يدوي إضافي بعد العرض",
    });
    expect(manualApproval.status).toBe(201);
    expect(manualApproval.body.data.input.manualDiscount).toBe("20.00");
    expect(
      (
        await send(
          owner,
          `/discount-approvals/${manualApproval.body.data.id}/decision`,
          { decision: "APPROVED", note: "موافقة على الخصم الإضافي" },
        )
      ).status,
    ).toBe(200);
    const sold = await send(manager, "/sales", {
      ...input,
      discountApprovalId: manualApproval.body.data.id,
    });
    expect(sold.status).toBe(201);
    expect(sold.body.data.total).toBe("180");
    const beforeReturns = await db.saleReturn.count();
    const partial = await send(owner, `/sales/${sold.body.data.id}/returns`, {
      shiftId: ownerShift.id,
      reason: "محاولة إرجاع جزئي للعرض",
      method: "CASH",
      items: [
        { saleItemId: sold.body.data.items[0].id, quantity: 1, sellable: true },
      ],
    });
    expect(partial.body.error.code).toBe("PROMOTION_RETURN_GROUP");
    expect(await db.saleReturn.count()).toBe(beforeReturns);
    await db.promotion.update({
      where: { id: bundle.body.data.id },
      data: { active: false, name: "Changed campaign after sale" },
    });
    const returned = await send(owner, `/sales/${sold.body.data.id}/returns`, {
      shiftId: ownerShift.id,
      reason: "إرجاع أصناف العرض معًا",
      method: "CASH",
      items: sold.body.data.items.map((i: any) => ({
        saleItemId: i.id,
        quantity: i.quantity,
        sellable: true,
      })),
    });
    expect(returned.status).toBe(200);
    expect(Number(returned.body.data.total)).toBe(180);
    expect(sold.body.data.receiptSnapshot.promotion.name).toBe(campaign.name);
    const percentageSale = await send(manager, "/sales", {
      shiftId: managerShift.id,
      items: [{ variantId: a.id, quantity: 2 }],
      payments: [{ method: "CASH", amount: "150" }],
    });
    expect(percentageSale.status).toBe(201);
    const one = await send(
      owner,
      `/sales/${percentageSale.body.data.id}/returns`,
      {
        shiftId: ownerShift.id,
        reason: "مرتجع جزئي لعرض نسبة",
        method: "CASH",
        items: [
          {
            saleItemId: percentageSale.body.data.items[0].id,
            quantity: 1,
            sellable: true,
          },
        ],
      },
    );
    expect(one.status).toBe(200);
    expect(Number(one.body.data.total)).toBe(75);
    await db.promotion.update({
      where: { id: percentage.body.data.id },
      data: { active: false },
    });
    const future = await send(owner, "/promotions", {
      ...campaign,
      name: "عرض لم يبدأ بعد",
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: new Date(Date.now() + 2 * 86400000).toISOString(),
    });
    const notStarted = await send(manager, "/sales/quote", quote);
    expect(notStarted.body.data.promotion).toBeNull();
    await db.promotion.update({
      where: { id: future.body.data.id },
      data: { active: false },
    });
  });
  it("stores authorized logos once and preserves receipt branding when store logo changes", async () => {
    await resetFixtureQuota();
    const previous = await db.systemSetting.findUniqueOrThrow({
        where: { key: "store" },
      }),
      bytes = await readFile("apps/web/public/brand/az-logo.jpg"),
      dataUrl = `data:image/jpeg;base64,${bytes.toString("base64")}`;
    expect((await send(cashier, "/settings/logo", { dataUrl })).status).toBe(
      403,
    );
    expect(
      (
        await send(owner, "/settings/logo", {
          dataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
        })
      ).status,
    ).toBe(400);
    const logo = await send(owner, "/settings/logo", { dataUrl });
    expect(logo.status).toBe(200);
    const again = await send(owner, "/settings/logo", { dataUrl });
    expect(again.body.data.logoUrl).toBe(logo.body.data.logoUrl);
    expect(await db.brandAsset.count()).toBe(1);
    const publicAsset = await request(app).get(logo.body.data.logoUrl);
    expect(publicAsset.status).toBe(200);
    expect(publicAsset.headers["content-type"]).toContain("image/jpeg");
    expect(Buffer.compare(publicAsset.body, bytes)).toBe(0);
    expect((await request(app).get("/api/branding")).body.data.logoUrl).toBe(
      logo.body.data.logoUrl,
    );
    const shift = await db.cashShift.findFirstOrThrow({
        where: { userId: owner.user.id, closedAt: null },
      }),
      v = await db.productVariant.findUniqueOrThrow({
        where: { sku: "PROMO-A" },
      });
    const sold = await send(owner, "/sales", {
      shiftId: shift.id,
      items: [{ variantId: v.id, quantity: 1 }],
      payments: [{ method: "CASH", amount: "100" }],
    });
    expect(sold.status).toBe(201);
    expect(sold.body.data.receiptSnapshot.logoUrl).toBe(logo.body.data.logoUrl);
    await db.systemSetting.update({
      where: { key: "store" },
      data: { value: previous.value as any },
    });
    expect(
      (await db.sale.findUniqueOrThrow({ where: { id: sold.body.data.id } }))
        .receiptSnapshot,
    ).toMatchObject({ logoUrl: logo.body.data.logoUrl });
  });
  it("prints the requested VAT-inclusive receipt and completes mixed payment and net exchange in the browser", async () => {
    // This isolated browser scenario must not inherit the request burst from
    // all preceding API fixtures. Production keeps the same 300/minute limit.
    const { apiRateLimiter } = await import("../apps/api/src/app.js");
    apiRateLimiter.resetKey("127.0.0.1");
    apiRateLimiter.resetKey("::ffff:127.0.0.1");
    const previous = await db.systemSetting.findUniqueOrThrow({
        where: { key: "store" },
      }),
      category = await db.category.findFirstOrThrow({
        where: { name: "ملابس" },
      }),
      ownerShift = await db.cashShift.findFirstOrThrow({
        where: { userId: owner.user.id, closedAt: null },
      });
    await db.systemSetting.update({
      where: { key: "store" },
      data: {
        value: {
          ...(previous.value as Record<string, any>),
          taxMode: "INCLUSIVE",
          taxRate: "14",
          branchName: "فرع مول مصر - الدور الأرضي",
          taxNumber: "XXX-XXX-XXX",
          commercialRegister: "XXXXXX",
          receiptFooter: "شكراً لزيارتكم | نموذج معاينة",
        },
      },
    });
    await db.user.update({
      where: { id: owner.user.id },
      data: { name: "أحمد محمود", employeeCode: "SELLER-001" },
    });
    const first = await send(owner, "/products", {
        nameAr: "بادي قطن ليكرا أساسي",
        sku: "RECEIPT-BODY",
        categoryId: category.id,
        returnRule: "DEFECT_ONLY",
        variants: [
          {
            sku: "CR-1042",
            price: "320",
            options: { اللون: "أسود", المقاس: "M" },
          },
        ],
      }),
      second = await send(owner, "/products", {
        nameAr: "ليجنز رياضي ضاغط",
        sku: "RECEIPT-LEGGINGS",
        categoryId: category.id,
        variants: [
          {
            sku: "CR-2118",
            price: "450",
            options: { اللون: "كحلي", المقاس: "L" },
          },
        ],
      });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const a = first.body.data.variants[0],
      b = second.body.data.variants[0];
    await send(owner, "/inventory/adjustments", {
      variantId: a.id,
      locationId: location.id,
      quantity: 10,
      reason: "Receipt preview stock",
      cost: "180",
    });
    await send(owner, "/inventory/adjustments", {
      variantId: b.id,
      locationId: location.id,
      quantity: 10,
      reason: "Receipt preview stock",
      cost: "250",
    });
    const http = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => http.once("listening", r));
    const apiPort = (http.address() as { port: number }).port;
    const web = await preview({
        root: resolve("apps/web"),
        preview: {
          host: "127.0.0.1",
          port: await availablePort(),
          strictPort: true,
          proxy: { "/api": `http://127.0.0.1:${apiPort}` },
        },
      }),
      url = `http://127.0.0.1:${(web.httpServer.address() as { port: number }).port}`;
    process.env.APP_ORIGIN = url;
    const browser = await chromium.launch({
        channel: process.env.BROWSER_CHANNEL ?? "msedge",
        headless: true,
        timeout: 15000,
      }),
      context = await browser.newContext({
        viewport: { width: 1440, height: 1100 },
      }),
      page = await context.newPage();
    page.on("pageerror", (e) =>
      console.info("Receipt browser error: " + e.message),
    );
    try {
      await mkdir("output/pdf", { recursive: true });
      await page.goto(url);
      await page.getByLabel("البريد الإلكتروني").fill("owner@example.test");
      await page.getByLabel("كلمة المرور", { exact: true }).fill(password);
      await page
        .getByRole("button", { name: "تسجيل الدخول", exact: true })
        .click();
      await browserExpect(
        page.getByRole("heading", { name: /أهلاً/ }),
      ).toBeVisible();
      await openSidebarPage(page, "المنتجات");
      for (const withImage of [false, true]) {
        await page
          .getByRole("button", { name: "إضافة منتج", exact: true })
          .click();
        const form = page.getByRole("dialog");
        const sku = withImage ? "BROWSER-IMAGE" : "BROWSER-NO-IMAGE";
        await form
          .locator('input[name="nameAr"]')
          .fill("منتج اختبار صورة اختيارية");
        await form.locator('input[name="sku"]').fill(sku);
        await form
          .locator('select[name="categoryId"]')
          .selectOption({ index: 1 });
        await form
          .locator(".variant-row input")
          .nth(0)
          .fill(sku + "-V1");
        await form.locator(".variant-row input").nth(3).fill("15");
        if (withImage) {
          await form
            .getByLabel("صورة المنتج (اختياري)", { exact: true })
            .setInputFiles("apps/web/public/brand/az-logo.jpg");
          await browserExpect(
            form.locator(".product-image-preview img"),
          ).toBeVisible();
          await form
            .getByRole("button", { name: "إزالة الصورة", exact: true })
            .click();
          await browserExpect(
            form.locator(".product-image-preview img"),
          ).toHaveCount(0);
          await form
            .getByLabel("صورة المنتج (اختياري)", { exact: true })
            .setInputFiles("apps/web/public/brand/az-logo.jpg");
          await browserExpect(
            form.locator(".product-image-preview img"),
          ).toBeVisible();
          await page.screenshot({
            path: "test-results/new-product-optional-image.png",
            fullPage: true,
          });
        }
        const creation = page.waitForResponse(
          (r) =>
            r.url().endsWith("/api/products") &&
            r.request().method() === "POST",
        );
        await form.getByRole("button", { name: "حفظ", exact: true }).click();
        const response = await creation;
        expect(response.status()).toBe(201);
        const body = await response.json();
        if (withImage)
          expect(body.data.imageUrl).toMatch(/^\/api\/brand-assets\//);
        else expect(body.data.imageUrl).toBeNull();
        await browserExpect(form).toHaveCount(0);
      }
      await page.locator(".toolbar input").fill("DRESS-TEST");
      await page
        .getByRole("row")
        .filter({ hasText: "DRESS-TEST" })
        .getByRole("button", { name: "التفاصيل", exact: true })
        .click();
      const imageUpload = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/products/${product.id}/image`) &&
          r.request().method() === "POST",
      );
      await page
        .getByLabel("رفع صورة المنتج", { exact: true })
        .setInputFiles("apps/web/public/brand/az-logo.jpg");
      expect((await imageUpload).status()).toBe(200);
      await browserExpect(
        page.locator(".product-image-preview img"),
      ).toBeVisible();
      await page.screenshot({
        path: "test-results/product-image-editor.png",
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await openSidebarPage(page, "نقطة البيع");
      await browserExpect(
        page.locator(".catalog-art img").first(),
      ).toBeVisible();
      await page.screenshot({
        path: "test-results/product-images-pos.png",
        fullPage: true,
      });
      await openSidebarPage(page, "إعدادات المتجر");
      const logoUpload = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/settings/logo") &&
          r.request().method() === "POST",
      );
      await page
        .getByLabel("رفع لوجو المتجر", { exact: true })
        .setInputFiles("apps/web/public/brand/az-logo.jpg");
      expect((await logoUpload).status()).toBe(200);
      await browserExpect(page.locator(".logo-settings img")).toHaveAttribute(
        "src",
        /\/api\/brand-assets\/[a-f0-9]{64}/,
      );
      await page.screenshot({
        path: "test-results/logo-settings.png",
        fullPage: true,
      });
      await openSidebarPage(page, "نقطة البيع");
      const managerContext = await browser.newContext({
        viewport: { width: 1440, height: 1100 },
      });
      expect(
        (
          await managerContext.request.post(`${url}/api/auth/login`, {
            headers: { Origin: url },
            data: { email: "manager@example.test", password },
          })
        ).status(),
      ).toBe(200);
      const managerPage = await managerContext.newPage();
      await managerPage.goto(`${url}/pos`);
      await managerPage
        .getByRole("textbox", { name: "مسح الباركود" })
        .fill(b.barcode);
      await managerPage
        .getByRole("textbox", { name: "مسح الباركود" })
        .press("Enter");
      await browserExpect(managerPage.locator(".cart-line")).toHaveCount(1);
      await pickPosCustomer(managerPage);
      await managerPage
        .getByLabel("خصم على الفاتورة", { exact: true })
        .fill("20");
      await managerPage
        .getByLabel("سبب تجاوز حد الخصم", { exact: true })
        .fill("طلب خصم من شاشة الكاشير");
      await managerPage
        .getByRole("button", { name: "طلب موافقة المدير", exact: true })
        .click();
      await browserExpect(
        managerPage.getByText("طلب الخصم قيد المراجعة.", { exact: false }),
      ).toBeVisible();
      await browserExpect(
        managerPage.getByRole("button", { name: "إتمام البيع", exact: true }),
      ).toBeDisabled();
      await openSidebarPage(page, "موافقات الخصومات");
      const approvalRow = page
        .getByRole("row")
        .filter({ hasText: "طلب خصم من شاشة الكاشير" });
      await approvalRow
        .getByRole("button", { name: "مراجعة الطلب", exact: true })
        .click();
      await browserExpect(page.getByRole("dialog")).toContainText(
        "ليجنز رياضي ضاغط",
      );
      await page
        .getByLabel("ملاحظة القرار", { exact: true })
        .fill("معتمد من المدير بعد مراجعة الطلب");
      await page.screenshot({
        path: "test-results/discount-approval-review.png",
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "الموافقة على الخصم", exact: true })
        .click();
      await browserExpect(
        managerPage.getByText("المدير وافق على الخصم لهذه السلة.", {
          exact: false,
        }),
      ).toBeVisible({ timeout: 15000 });
      await managerPage.screenshot({
        path: "test-results/discount-approval-pos.png",
        fullPage: true,
      });
      await managerPage
        .getByRole("button", { name: "إتمام البيع", exact: true })
        .click();
      await browserExpect(
        managerPage.locator(".receipt-preview"),
      ).toBeVisible();
      const approvalRecord = await db.discountApproval.findFirstOrThrow({
        where: { reason: "طلب خصم من شاشة الكاشير" },
      });
      expect(approvalRecord.status).toBe("CONSUMED");
      expect(approvalRecord.approverId).toBe(owner.user.id);
      await managerContext.close();
      await openSidebarPage(page, "العروض التلقائية");
      await page
        .getByRole("button", { name: "إضافة عرض", exact: true })
        .click();
      await page
        .getByLabel("اسم العرض", { exact: true })
        .fill("عرض المتصفح 2+1");
      await page
        .getByLabel("المنتجات المشمولة", { exact: true })
        .selectOption("selected");
      await page
        .getByRole("checkbox", { name: /بادي قطن ليكرا أساسي/ })
        .check();
      await page.getByRole("checkbox", { name: /ليجنز رياضي ضاغط/ }).check();
      await page
        .getByRole("button", { name: "حفظ العرض", exact: true })
        .click();
      await browserExpect(
        page.getByRole("row").filter({ hasText: "عرض المتصفح 2+1" }),
      ).toBeVisible();
      await page.screenshot({
        path: "test-results/promotions-manager.png",
        fullPage: true,
      });
      await openSidebarPage(page, "نقطة البيع");
      for (const barcode of [a.barcode, a.barcode, b.barcode]) {
        await page.getByRole("textbox", { name: "مسح الباركود" }).fill(barcode);
        await page
          .getByRole("textbox", { name: "مسح الباركود" })
          .press("Enter");
      }
      await browserExpect(
        page.getByRole("status").filter({ hasText: "عرض المتصفح 2+1" }),
      ).toBeVisible();
      await pickPosCustomer(page);
      await page
        .getByRole("button", { name: "إتمام البيع", exact: true })
        .click();
      await browserExpect(page.locator(".receipt-preview")).toContainText(
        "770.00",
      );
      await browserExpect(page.locator(".receipt-preview")).toContainText(
        "675.44",
      );
      await browserExpect(page.locator(".receipt-preview")).toContainText(
        "94.56",
      );
      await browserExpect(page.locator(".receipt-preview")).toContainText(
        "جميع أصناف العرض",
      );
      await page
        .locator(".receipt-preview img")
        .evaluate((img: HTMLImageElement) => img.decode());
      await page
        .locator(".receipt-preview")
        .screenshot({ path: "test-results/promotion-receipt.png" });
      await page.emulateMedia({ media: "print" });
      const promotionPdf = await page.pdf({
        path: "test-results/promotion-receipt.pdf",
        preferCSSPageSize: true,
        printBackground: true,
      });
      expect(
        (promotionPdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? [])
          .length,
      ).toBe(1);
      await page.emulateMedia({ media: "screen" });
      execFileSync(
        process.execPath,
        [
          "scripts/render-pdf.mjs",
          "test-results/promotion-receipt.pdf",
          "test-results/promotion-receipt-print.png",
        ],
        { stdio: "pipe" },
      );
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "إلغاء", exact: true })
        .click();
      await openSidebarPage(page, "العروض التلقائية");
      await page
        .getByRole("row")
        .filter({ hasText: "عرض المتصفح 2+1" })
        .getByRole("button", { name: "تعديل العرض", exact: true })
        .click();
      await page
        .getByRole("checkbox", {
          name: "تفعيل العرض في الفترة المحددة",
          exact: true,
        })
        .uncheck();
      await page
        .getByRole("button", { name: "حفظ العرض", exact: true })
        .click();
      await browserExpect(
        page.getByRole("row").filter({ hasText: "عرض المتصفح 2+1" }),
      ).toContainText("متوقف");
      await openSidebarPage(page, "نقطة البيع");
      for (const code of [a.barcode, a.barcode, b.barcode]) {
        await page.getByRole("textbox", { name: "مسح الباركود" }).fill(code);
        await page
          .getByRole("textbox", { name: "مسح الباركود" })
          .press("Enter");
      }
      await browserExpect(page.locator(".cart-line")).toHaveCount(2);
      await page.getByLabel("خصم CR-2118", { exact: true }).fill("50");
      await page
        .getByLabel("طريقة الدفع", { exact: true })
        .selectOption("CARD");
      await page
        .getByLabel("نوع البطاقة", { exact: true })
        .selectOption("Visa");
      await page.getByLabel("رقم التفويض", { exact: true }).fill("492810");
      await page
        .getByLabel("آخر 4 أرقام (اختياري)", { exact: true })
        .fill("4321");
      await page
        .getByLabel("ملاحظات", { exact: true })
        .fill("سلة محفوظة بعد إعادة التحميل");
      await page.reload();
      await browserExpect(page.locator(".cart-line")).toHaveCount(2);
      await browserExpect(
        page.getByLabel("خصم CR-2118", { exact: true }),
      ).toHaveValue("50");
      await browserExpect(
        page.getByLabel("رقم التفويض", { exact: true }),
      ).toHaveValue("492810");
      await page
        .getByRole("button", { name: "تعليق السلة", exact: true })
        .click();
      await browserExpect(page.locator(".cart-line")).toHaveCount(0);
      await page.getByRole("textbox", { name: "مسح الباركود" }).fill(b.barcode);
      await page.getByRole("textbox", { name: "مسح الباركود" }).press("Enter");
      await browserExpect(page.locator(".cart-line")).toHaveCount(1);
      await page
        .getByRole("button", { name: "تعليق السلة", exact: true })
        .click();
      await page.reload();
      await page
        .getByLabel("اختر سلة معلّقة", { exact: true })
        .selectOption({ index: 1 });
      await page
        .getByRole("button", { name: "استئناف (2)", exact: true })
        .click();
      await browserExpect(page.locator(".cart-line")).toHaveCount(2);
      await browserExpect(
        page.getByLabel("ملاحظات", { exact: true }),
      ).toHaveValue("سلة محفوظة بعد إعادة التحميل");
      await browserExpect(
        page.getByLabel("رقم التفويض", { exact: true }),
      ).toHaveValue("492810");
      const otherTab = await page.context().newPage();
      otherTab.on("response", (response) => {
        if (response.status() === 429)
          console.info("Other-tab rate limit: " + response.url());
      });
      await otherTab.goto(`${url}/pos`);
      await otherTab.screenshot({
        path: "test-results/other-tab-state.png",
        fullPage: true,
      });
      await browserExpect(
        otherTab.getByText("نقطة البيع مفتوحة لحسابك في تبويب آخر.", {
          exact: false,
        }),
      ).toBeVisible();
      await browserExpect(
        otherTab.getByRole("button", { name: "إتمام البيع", exact: true }),
      ).toBeDisabled();
      await otherTab.close();
      const saleCountBeforeRecovery = await db.sale.count();
      await pickPosCustomer(page);
      let dropPhase = 0;
      const submittedKeys: string[] = [];
      await page.route("**/api/sales", async (route) => {
        if (route.request().method() === "POST" && dropPhase < 2) {
          submittedKeys.push(route.request().headers()["idempotency-key"]);
          if (dropPhase++ === 0) {
            await route.abort("failed");
            return;
          }
          const result = await route.fetch();
          expect(result.status()).toBe(201);
          await route.abort("failed");
        } else await route.continue();
      });
      const cashBefore = await db.cashMovement.aggregate({
        where: { shiftId: ownerShift.id },
        _sum: { amount: true },
      });
      await page
        .getByRole("button", { name: "إتمام البيع", exact: true })
        .click();
      await browserExpect(
        page.getByRole("button", {
          name: "إعادة إرسال نفس المحاولة",
          exact: true,
        }),
      ).toBeEnabled();
      await browserExpect(
        page.getByRole("textbox", { name: "مسح الباركود" }),
      ).toBeDisabled();
      await page.reload();
      await browserExpect(
        page.getByText("لم تظهر فاتورة مسجلة لهذه المحاولة.", { exact: false }),
      ).toBeVisible();
      await page.screenshot({
        path: "test-results/pos-recovery.png",
        fullPage: true,
      });
      expect(await db.sale.count()).toBe(saleCountBeforeRecovery);
      await page
        .getByRole("button", { name: "إعادة إرسال نفس المحاولة", exact: true })
        .click();
      await browserExpect(
        page.getByRole("button", {
          name: "إعادة إرسال نفس المحاولة",
          exact: true,
        }),
      ).toBeEnabled();
      expect(submittedKeys).toHaveLength(2);
      expect(submittedKeys[0]).toBe(submittedKeys[1]);
      await page.reload();
      await browserExpect(page.locator(".receipt-preview")).toBeVisible();
      expect(await db.sale.count()).toBe(saleCountBeforeRecovery + 1);
      await page.reload();
      await browserExpect(page.locator(".receipt-preview")).toBeVisible();
      expect(await db.sale.count()).toBe(saleCountBeforeRecovery + 1);
      const receipt = page.locator(".receipt-preview");
      for (const value of [
        "1,090.00",
        "912.28",
        "127.72",
        "1,040.00",
        "492810",
        "CR-1042",
        "CR-2118",
        "SELLER-001",
        "مشمولة بالسعر",
      ])
        await browserExpect(receipt).toContainText(value);
      const saleId = (await receipt.getAttribute("data-sale-id"))!,
        stored = await db.sale.findUniqueOrThrow({
          where: { id: saleId },
          include: { items: true, payments: true },
        });
      expect(
        stored.items.find((i) => i.sku === "CR-1042")!.discount.toFixed(2),
      ).toBe("0.00");
      expect(
        stored.items.find((i) => i.sku === "CR-2118")!.discount.toFixed(2),
      ).toBe("50.00");
      expect(stored.netBeforeTax.toFixed(2)).toBe("912.28");
      expect(stored.payments[0]!.authorizationCode).toBe("492810");
      const cashAfterCard = await db.cashMovement.aggregate({
        where: { shiftId: ownerShift.id },
        _sum: { amount: true },
      });
      expect(String(cashAfterCard._sum.amount ?? 0)).toBe(
        String(cashBefore._sum.amount ?? 0),
      );
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        );
      });
      await receipt.screenshot({ path: "test-results/receipt-vat14.png" });
      await page.emulateMedia({ media: "print" });
      const pdf = await page.pdf({
        path: "output/pdf/az-receipt-preview.pdf",
        preferCSSPageSize: true,
        printBackground: true,
      });
      expect(
        (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length,
      ).toBe(1);
      await page.emulateMedia({ media: "screen" });
      const rendered = execFileSync(
        process.execPath,
        [
          "scripts/render-pdf.mjs",
          "output/pdf/az-receipt-preview.pdf",
          "output/pdf/az-receipt-preview.png",
        ],
        { encoding: "utf8", stdio: "pipe" },
      );
      const metadata = JSON.parse(rendered.trim().split("\n").at(-1)!);
      expect(metadata.pages).toBe(1);
      expect(metadata.width).toBeCloseTo((80 * 72) / 25.4, 0);
      for (const value of ["912.28", "127.72", "1,040.00", "492810", "CR-1042"])
        expect(metadata.text).toContain(value);
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "إلغاء", exact: true })
        .click();
      await page.getByRole("textbox", { name: "مسح الباركود" }).fill(b.barcode);
      await page.getByRole("textbox", { name: "مسح الباركود" }).press("Enter");
      await browserExpect(page.locator(".cart-line")).toHaveCount(1);
      await page
        .getByRole("button", { name: "إضافة طريقة دفع", exact: true })
        .click();
      await page.getByLabel("المبلغ 1", { exact: true }).fill("200");
      await page
        .getByLabel("طريقة الدفع 2", { exact: true })
        .selectOption("CARD");
      await page.getByLabel("المبلغ 2", { exact: true }).fill("250");
      await page
        .getByLabel("نوع البطاقة 2", { exact: true })
        .selectOption("Visa");
      await page
        .getByLabel("رقم التفويض 2", { exact: true })
        .fill("MIX-492811");
      await pickPosCustomer(page);
      await page
        .getByRole("button", { name: "إتمام البيع", exact: true })
        .click();
      await browserExpect(page.locator(".receipt-preview")).toBeVisible();
      const mixedId = (await page
          .locator(".receipt-preview")
          .getAttribute("data-sale-id"))!,
        mixed = await db.sale.findUniqueOrThrow({
          where: { id: mixedId },
          include: { payments: true },
        });
      expect(mixed.payments.map((p) => p.amount.toString()).sort()).toEqual([
        "200",
        "250",
      ]);
      const afterMixed = await db.cashMovement.aggregate({
        where: { shiftId: ownerShift.id },
        _sum: { amount: true },
      });
      expect(
        Number(afterMixed._sum.amount ?? 0) -
          Number(cashAfterCard._sum.amount ?? 0),
      ).toBe(200);
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "إلغاء", exact: true })
        .click();
      await openSidebarPage(page, "المبيعات");
      await page
        .getByPlaceholder("ابحث برقم الفاتورة")
        .fill(mixed.receiptNumber!);
      await page
        .getByRole("button", { name: "عرض الفاتورة", exact: true })
        .click();
      await page
        .getByRole("button", { name: "استبدال منتجات", exact: true })
        .click();
      await page.getByLabel("كمية استبدال CR-2118", { exact: true }).fill("1");
      await page
        .getByLabel("سبب الاستبدال بالتفصيل", { exact: true })
        .fill("استبدال مقاس ولون");
      await page
        .getByLabel("الصنف البديل 1", { exact: true })
        .selectOption(a.id);
      await page
        .getByRole("button", { name: "اعتماد الاستبدال", exact: true })
        .click();
      await browserExpect(page.locator(".receipt-preview")).toContainText(
        "فرق السعر المسترد",
      );
      await browserExpect(page.locator(".receipt-preview")).toContainText(
        "130.00",
      );
      await page
        .locator(".receipt-preview")
        .screenshot({ path: "test-results/exchange-receipt.png" });
      const exchange = await db.exchange.findUniqueOrThrow({
        where: {
          replacementSaleId: (await page
            .locator(".receipt-preview")
            .getAttribute("data-sale-id"))!,
        },
        include: { return: true },
      });
      expect(exchange.difference.toString()).toBe("-130");
      expect(exchange.return.refundAmount.toString()).toBe("130");
      const afterExchange = await db.cashMovement.aggregate({
        where: { shiftId: ownerShift.id },
        _sum: { amount: true },
      });
      expect(
        Number(afterMixed._sum.amount ?? 0) -
          Number(afterExchange._sum.amount ?? 0),
      ).toBe(130);
    } catch (e) {
      await page
        .screenshot({
          path: "test-results/receipt-feature-failure.png",
          fullPage: true,
        })
        .catch(() => {});
      for (const [i, tab] of page.context().pages().entries())
        await tab
          .screenshot({
            path: `test-results/receipt-tab-${i}.png`,
            fullPage: true,
          })
          .catch(() => {});
      throw e;
    } finally {
      await browser.close();
      web.httpServer.closeAllConnections();
      await new Promise<void>((r) => web.httpServer.close(() => r()));
      await new Promise<void>((r) => http.close(() => r()));
      process.env.APP_ORIGIN = origin;
      await db.systemSetting.update({
        where: { key: "store" },
        data: { value: previous.value as any },
      });
    }
  }, 90000);
  it.skipIf(!process.env.PG_BIN)(
    "restores a real pg_dump and reconciles stock and invoice totals",
    async () => {
      const bin = process.env.PG_BIN!,
        ext = process.platform === "win32" ? ".exe" : "",
        dump = resolve(".test-data/restore-check.dump");
      const env = { ...process.env, PGPASSWORD: password };
      execFileSync(
        join(bin, `pg_dump${ext}`),
        [
          "-h",
          "127.0.0.1",
          "-p",
          String(pgPort),
          "-U",
          "az_test",
          "-d",
          "az_test",
          "-Fc",
          "-f",
          dump,
        ],
        { env, stdio: "pipe" },
      );
      await pg.createDatabase("az_restore");
      execFileSync(
        join(bin, `pg_restore${ext}`),
        [
          "-h",
          "127.0.0.1",
          "-p",
          String(pgPort),
          "-U",
          "az_test",
          "-d",
          "az_restore",
          "--no-owner",
          "--no-privileges",
          "--exit-on-error",
          dump,
        ],
        { env, stdio: "pipe" },
      );
      const restored = pg.getPgClient("az_restore", "127.0.0.1");
      await restored.connect();
      try {
        const totals = await restored.query(
          'SELECT COUNT(*)::int AS count, SUM(total)::text AS total FROM "Sale"',
        );
        const source = await db.sale.aggregate({
          _count: true,
          _sum: { total: true },
        });
        expect(totals.rows[0].count).toBe(source._count);
        expect(totals.rows[0].total).toBe(source._sum.total!.toFixed(2));
        const mismatch = await restored.query(
          'SELECT b."variantId" FROM "StockBalance" b LEFT JOIN "StockMovement" m ON m."variantId"=b."variantId" AND m."locationId"=b."locationId" GROUP BY b."variantId", b."locationId", b.quantity HAVING b.quantity <> COALESCE(SUM(m.quantity),0)',
        );
        expect(mismatch.rowCount).toBe(0);
      } finally {
        await restored.end();
      }
    },
  );
  it("customer history reconciles returns, paginates, edits and respects sales visibility", async () => {
    const created = await send(owner, "/customers", {
      name: "History customer",
      phone: "01099887766",
    });
    expect(created.status).toBe(201);
    const customer = created.body.data;
    const historyShift = await db.cashShift.findFirstOrThrow({
      where: { userId: owner.user.id, closedAt: null },
    });
    const historyProduct = await send(owner, "/products", {
      nameAr: "History item",
      sku: "HIST",
      categoryId: product.categoryId,
      variants: [{ sku: "HIST-1", price: "62.50" }],
    });
    expect(historyProduct.status).toBe(201);
    const historyVariant = historyProduct.body.data.variants[0];
    expect(
      (
        await send(owner, "/inventory/adjustments", {
          variantId: historyVariant.id,
          locationId: location.id,
          quantity: 2,
          reason: "Isolated history test",
        })
      ).status,
    ).toBe(200);
    const sold = await send(owner, "/sales", {
      shiftId: historyShift.id,
      customerId: customer.id,
      items: [{ variantId: historyVariant.id, quantity: 2 }],
      payments: [{ method: "CASH", amount: "1000" }],
    });
    expect(sold.status).toBe(201);
    const fixture = sold.body.data;
    expect(
      (
        await send(owner, `/sales/${fixture.id}/returns`, {
          shiftId: historyShift.id,
          reason: "History return",
          method: "CASH",
          items: [
            { saleItemId: fixture.items[0].id, quantity: 1, sellable: true },
          ],
        })
      ).status,
    ).toBe(200);
    const history = await owner.agent.get(
      `/api/customers/${customer.id}/history?limit=1`,
    );
    expect(history.status).toBe(200);
    expect(history.body.data.summary).toEqual({
      purchaseCount: 1,
      purchases: "125.00",
      returns: "62.50",
      netSpending: "62.50",
    });
    expect(history.body.data.sales[0].id).toBe(fixture.id);
    expect(history.body.data.sales[0].items[0].unitCost).toBeUndefined();
    expect(history.body.data.returns[0].reason).toBe("History return");
    expect(
      (
        await owner.agent.get(
          `/api/customers/${customer.id}/history?offset=1&limit=1`,
        )
      ).body.data.sales,
    ).toEqual([]);
    expect(
      (await cashier.agent.get(`/api/customers/${customer.id}/history`)).status,
    ).toBe(403);
    const limitedRole = await db.role.create({
      data: {
        name: "CUSTOMER_HISTORY_LIMITED",
        permissions: {
          create: ["customers.manage", "sales.view_own"].map((permission) => ({
            permission: { connect: { key: permission } },
          })),
        },
      },
    });
    const sourceUser = await db.user.findUniqueOrThrow({
      where: { id: owner.user.id },
    });
    await db.user.create({
      data: {
        name: "Limited history",
        email: "history-limited@example.test",
        passwordHash: sourceUser.passwordHash,
        roles: { create: { roleId: limitedRole.id } },
      },
    });
    const limited = await login("history-limited@example.test");
    const ownHistory = await limited.agent.get(
      `/api/customers/${customer.id}/history`,
    );
    expect(ownHistory.status).toBe(200);
    expect(ownHistory.body.data.scope).toBe("OWN");
    expect(ownHistory.body.data.summary.netSpending).toBe("0.00");
    expect(ownHistory.body.data.returns).toEqual([]);
    const update = await owner.agent
      .patch(`/api/customers/${customer.id}`)
      .set("Origin", process.env.APP_ORIGIN ?? origin)
      .set("X-CSRF-Token", owner.csrf)
      .send({
        name: "Edited customer",
        phone: customer.phone,
        email: null,
        address: "Cairo",
        notes: "Updated",
      });
    expect(update.status).toBe(200);
    expect(
      (
        await owner.agent.get("/api/customers?q=Edited%20customer")
      ).body.data.some((c: any) => c.id === customer.id),
    ).toBe(true);
    expect(
      await db.auditLog.count({
        where: { action: "CUSTOMER_UPDATE", reference: customer.id },
      }),
    ).toBe(1);
    expect(
      (await owner.agent.get(`/api/customers/${crypto.randomUUID()}/history`))
        .status,
    ).toBe(404);
    const previousOrigin = process.env.APP_ORIGIN;
    const http = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => http.once("listening", r));
    const web = await preview({
      root: resolve("apps/web"),
      preview: {
        host: "127.0.0.1",
        port: await availablePort(),
        strictPort: true,
        proxy: {
          "/api": `http://127.0.0.1:${(http.address() as { port: number }).port}`,
        },
      },
    });
    const url = `http://127.0.0.1:${(web.httpServer.address() as { port: number }).port}`;
    process.env.APP_ORIGIN = url;
    const browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL ?? "msedge",
      headless: true,
    });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
      });
      expect(
        (
          await context.request.post(url + "/api/auth/login", {
            headers: { Origin: url },
            data: { email: "owner@example.test", password },
          })
        ).status(),
      ).toBe(200);
      const page = await context.newPage();
      await page.goto(url + "/customers");
      await page.getByLabel("بحث العملاء").fill("Edited customer");
      await page
        .getByRole("button", { name: "سجل العميل", exact: true })
        .click();
      await browserExpect(
        page.getByRole("dialog").getByText("صافي الإنفاق", { exact: true }),
      ).toBeVisible();
      await browserExpect(
        page
          .getByRole("dialog")
          .getByText("History item × 2 (مرتجع: 1)", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: "test-results/customer-history.png",
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "المرتجعات", exact: true })
        .click();
      await browserExpect(
        page.getByRole("dialog").getByText("History return", { exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "تعديل", exact: true }).click();
      await page
        .getByRole("dialog")
        .getByLabel("الاسم (اختياري)", { exact: true })
        .fill("Browser edited customer");
      await page.getByRole("button", { name: "حفظ", exact: true }).click();
      await browserExpect(page.getByRole("dialog")).toHaveCount(0);
      await page.getByLabel("بحث العملاء").fill("Browser edited customer");
      await browserExpect(
        page.getByRole("cell", {
          name: "Browser edited customer",
          exact: true,
        }),
      ).toBeVisible();
    } finally {
      await browser.close();
      web.httpServer.closeAllConnections();
      await new Promise<void>((r) => web.httpServer.close(() => r()));
      http.closeAllConnections();
      await new Promise<void>((r) => http.close(() => r()));
      process.env.APP_ORIGIN = previousOrigin;
    }
  });
  it("loyalty earns once, redeems atomically, reverses partial returns and restores unexpired points", async () => {
    await resetFixtureQuota();
    const settings = {
      enabled: true,
      spendPerPoint: "10",
      pointValue: "1",
      expiryDays: 365,
      maxRedeemPercent: 50,
      minimumRedeemPoints: 1,
    };
    const configure = () =>
      owner.agent
        .patch("/api/loyalty/settings")
        .set("Origin", process.env.APP_ORIGIN ?? origin)
        .set("X-CSRF-Token", owner.csrf)
        .send(settings);
    expect((await configure()).status).toBe(200);
    expect(
      (
        await cashier.agent
          .patch("/api/loyalty/settings")
          .set("Origin", process.env.APP_ORIGIN ?? origin)
          .set("X-CSRF-Token", cashier.csrf)
          .send(settings)
      ).status,
    ).toBe(403);
    const store = await db.systemSetting.findUniqueOrThrow({
      where: { key: "store" },
    });
    await db.systemSetting.update({
      where: { key: "store" },
      data: {
        value: { ...(store.value as any), taxRate: "14", taxMode: "INCLUSIVE" },
      },
    });
    const c = (
      await send(owner, "/customers", {
        name: "Loyalty customer",
        phone: "01088776655",
      })
    ).body.data;
    const p = await send(owner, "/products", {
      nameAr: "Loyalty garment",
      sku: "LOYALTY-PRODUCT",
      categoryId: product.categoryId,
      variants: [{ sku: "LOYALTY-V1", price: "114" }],
    });
    expect(p.status).toBe(201);
    const v = p.body.data.variants[0];
    expect(
      (
        await send(owner, "/inventory/adjustments", {
          variantId: v.id,
          locationId: location.id,
          quantity: 30,
          cost: "40",
          reason: "Loyalty isolated test",
        })
      ).status,
    ).toBe(200);
    const ownShift = await db.cashShift.findFirstOrThrow({
      where: { userId: owner.user.id, closedAt: null },
    });
    const body = {
      shiftId: ownShift.id,
      customerId: c.id,
      items: [{ variantId: v.id, quantity: 2 }],
      payments: [{ method: "CASH", amount: "1000" }],
    };
    const key = crypto.randomUUID();
    const sold = await Promise.all([
      send(owner, "/sales", body, key),
      send(owner, "/sales", body, key),
    ]);
    expect(sold.map((r) => r.status)).toEqual([201, 201]);
    const earned = sold[0]!.body.data;
    expect(earned.receiptSnapshot.loyalty.earned).toBe(20);
    expect(
      await db.loyaltyEntry.count({
        where: { saleId: earned.id, kind: "EARN" },
      }),
    ).toBe(1);
    const balance = async () =>
      (await owner.agent.get(`/api/customers/${c.id}/loyalty`)).body.data;
    expect((await balance()).available).toBe(20);
    const redeem = await send(owner, "/sales", {
      ...body,
      loyaltyPoints: 10,
      items: [{ variantId: v.id, quantity: 1 }],
    });
    expect(redeem.status).toBe(201);
    const redeemed = redeem.body.data;
    expect(redeemed.total).toBe("104");
    expect(redeemed.receiptSnapshot.loyalty).toMatchObject({
      earned: 9,
      redeemed: 10,
      discount: "10.00",
    });
    expect((await balance()).available).toBe(19);
    const refundBody = (s: any, quantity: number) => ({
      shiftId: ownShift.id,
      reason: "Loyalty return",
      method: "CASH",
      items: [{ saleItemId: s.items[0].id, quantity, sellable: true }],
    });
    const firstReturn = await send(
      owner,
      `/sales/${earned.id}/returns`,
      refundBody(earned, 1),
    );
    expect(firstReturn.status).toBe(200);
    expect(firstReturn.body.data.loyalty).toEqual({
      reversed: 10,
      restored: 0,
    });
    expect((await balance()).available).toBe(9);
    const returnKey = crypto.randomUUID();
    const restored = await Promise.all([
      send(
        owner,
        `/sales/${redeemed.id}/returns`,
        refundBody(redeemed, 1),
        returnKey,
      ),
      send(
        owner,
        `/sales/${redeemed.id}/returns`,
        refundBody(redeemed, 1),
        returnKey,
      ),
    ]);
    expect(restored.map((r) => r.status)).toEqual([200, 200]);
    expect(restored[0]!.body.data.loyalty).toEqual({
      reversed: 9,
      restored: 10,
    });
    expect((await balance()).available).toBe(10);
    expect(
      (await send(owner, `/sales/${earned.id}/returns`, refundBody(earned, 1)))
        .status,
    ).toBe(200);
    expect((await balance()).available).toBe(0);
    expect((await balance()).debt).toBe(0);
    expect(
      (
        await send(owner, "/sales/quote", {
          ...body,
          customerId: undefined,
          loyaltyPoints: 1,
        })
      ).status,
    ).toBe(400);
    expect(
      (await send(owner, "/sales/quote", { ...body, loyaltyPoints: 1 })).status,
    ).toBe(409);
    const entry = await db.loyaltyEntry.findFirstOrThrow();
    await expect(
      db.loyaltyEntry.update({
        where: { id: entry.id },
        data: { points: 999 },
      }),
    ).rejects.toThrow();
    const original = await send(owner, "/sales", {
      ...body,
      items: [{ variantId: v.id, quantity: 1 }],
    });
    expect(original.status).toBe(201);
    const exchangeKey = crypto.randomUUID();
    const exchangeBody = {
      returned: refundBody(original.body.data, 1),
      replacement: {
        ...body,
        items: [{ variantId: v.id, quantity: 1 }],
        payments: [],
      },
    };
    const exchanges = await Promise.all([
      send(
        owner,
        `/sales/${original.body.data.id}/exchanges/net`,
        exchangeBody,
        exchangeKey,
      ),
      send(
        owner,
        `/sales/${original.body.data.id}/exchanges/net`,
        exchangeBody,
        exchangeKey,
      ),
    ]);
    expect(exchanges.map((r) => r.status)).toEqual([201, 201]);
    expect(exchanges[0]!.body.data.returned.loyalty.reversed).toBe(10);
    expect(
      exchanges[0]!.body.data.replacement.receiptSnapshot.loyalty.earned,
    ).toBe(10);
    expect((await balance()).available).toBe(10);
  });
  it("loyalty tracks spent-point debt, expiry and concurrent redemption without negative available points", async () => {
    await resetFixtureQuota();
    const v = await db.productVariant.findUniqueOrThrow({
      where: { sku: "LOYALTY-V1" },
    });
    const ownShift = await db.cashShift.findFirstOrThrow({
      where: { userId: owner.user.id, closedAt: null },
    });
    const c = (
      await send(owner, "/customers", {
        name: "Loyalty debt customer",
        phone: "01077665544",
      })
    ).body.data;
    const body = {
      shiftId: ownShift.id,
      customerId: c.id,
      items: [{ variantId: v.id, quantity: 1 }],
      payments: [{ method: "CASH", amount: "1000" }],
    };
    const a = await send(owner, "/sales", body);
    expect(a.status).toBe(201);
    const b = await send(owner, "/sales", { ...body, loyaltyPoints: 10 });
    expect(b.status).toBe(201);
    const returnBody = (s: any) => ({
      shiftId: ownShift.id,
      reason: "Spent loyalty points return",
      method: "CASH",
      items: [{ saleItemId: s.items[0].id, quantity: 1, sellable: true }],
    });
    expect(
      (
        await send(
          owner,
          `/sales/${a.body.data.id}/returns`,
          returnBody(a.body.data),
        )
      ).status,
    ).toBe(200);
    let account = (await owner.agent.get(`/api/customers/${c.id}/loyalty`)).body
      .data;
    expect(account).toMatchObject({ available: 0, debt: 1 });
    expect(
      (await send(owner, "/sales/quote", { ...body, loyaltyPoints: 1 })).status,
    ).toBe(409);
    const next = await send(owner, "/sales", body);
    expect(next.status).toBe(201);
    account = (await owner.agent.get(`/api/customers/${c.id}/loyalty`)).body
      .data;
    expect(account).toMatchObject({ available: 9, debt: 0 });
    const expiringCustomer = (
      await send(owner, "/customers", {
        name: "Expiry customer",
        phone: "01066554433",
      })
    ).body.data;
    const expiryBody = { ...body, customerId: expiringCustomer.id };
    const expirySale = await send(owner, "/sales", expiryBody);
    expect(expirySale.status).toBe(201);
    await db.loyaltyLot.update({
      where: { saleId: expirySale.body.data.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(
      (await owner.agent.get(`/api/customers/${expiringCustomer.id}/loyalty`))
        .body.data.available,
    ).toBe(0);
    expect(
      (await send(owner, "/sales/quote", { ...expiryBody, loyaltyPoints: 1 }))
        .status,
    ).toBe(409);
    expect(
      (
        await send(
          owner,
          `/sales/${expirySale.body.data.id}/returns`,
          returnBody(expirySale.body.data),
        )
      ).status,
    ).toBe(200);
    expect(
      (await owner.agent.get(`/api/customers/${expiringCustomer.id}/loyalty`))
        .body.data,
    ).toMatchObject({ available: 0, debt: 0 });
    expect(
      await db.loyaltyEntry.count({
        where: { customerId: expiringCustomer.id, kind: "EXPIRE" },
      }),
    ).toBe(1);
    for (const [index, awardFirst] of [true, false].entries()) {
      const expiryCustomer = (
        await send(owner, "/customers", {
          name: `Expired redemption ${index}`,
          phone: `0104433221${index}`,
        })
      ).body.data;
      const expiryBody = { ...body, customerId: expiryCustomer.id };
      const award = await send(owner, "/sales", expiryBody);
      expect(award.status).toBe(201);
      const redemption = await send(owner, "/sales", {
        ...expiryBody,
        loyaltyPoints: 10,
      });
      expect(redemption.status).toBe(201);
      await db.loyaltyLot.update({
        where: { saleId: award.body.data.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const first = awardFirst ? award : redemption,
        second = awardFirst ? redemption : award;
      expect(
        (
          await send(
            owner,
            `/sales/${first.body.data.id}/returns`,
            returnBody(first.body.data),
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await send(
            owner,
            `/sales/${second.body.data.id}/returns`,
            returnBody(second.body.data),
          )
        ).status,
      ).toBe(200);
      expect(
        (await owner.agent.get(`/api/customers/${expiryCustomer.id}/loyalty`))
          .body.data,
      ).toMatchObject({ available: 0, debt: 0 });
    }
    const concurrent = (
      await send(owner, "/customers", {
        name: "Concurrent customer",
        phone: "01055443322",
      })
    ).body.data;
    const concurrentBody = { ...body, customerId: concurrent.id };
    expect((await send(owner, "/sales", concurrentBody)).status).toBe(201);
    let managerShift = await db.cashShift.findFirst({
      where: { userId: manager.user.id, closedAt: null },
    });
    if (!managerShift) {
      const register = await db.register.create({
        data: {
          name: "Concurrent loyalty register",
          branchId: branch.id,
          locationId: location.id,
        },
      });
      const opened = await send(manager, "/shifts/open", {
        registerId: register.id,
        openingCash: "100",
      });
      expect(opened.status).toBe(201);
      managerShift = opened.body.data;
    }
    const attempts = await Promise.all([
      send(manager, "/sales", {
        ...concurrentBody,
        shiftId: managerShift!.id,
        loyaltyPoints: 10,
      }),
      send(owner, "/sales", { ...concurrentBody, loyaltyPoints: 10 }),
    ]);
    expect(attempts.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (await owner.agent.get(`/api/customers/${concurrent.id}/loyalty`)).body
        .data.available,
    ).toBe(9);
    const emptyProduct = await send(owner, "/products", {
      nameAr: "No stock loyalty",
      sku: "LOYALTY-EMPTY",
      categoryId: product.categoryId,
      variants: [{ sku: "LOYALTY-EMPTY-V1", price: "114" }],
    });
    const before = await db.loyaltyEntry.count({
      where: { customerId: concurrent.id },
    });
    expect(
      (
        await send(owner, "/sales", {
          ...concurrentBody,
          loyaltyPoints: 1,
          items: [
            { variantId: emptyProduct.body.data.variants[0].id, quantity: 1 },
          ],
        })
      ).status,
    ).toBe(409);
    expect(
      await db.loyaltyEntry.count({ where: { customerId: concurrent.id } }),
    ).toBe(before);
  });
  it("posts immutable transfers, damaged-stock writeoffs and adjustment documents with cost and stock conservation", async () => {
    await resetFixtureQuota();
    const p = await send(owner, "/products", {
      nameAr: "Stock document garment",
      sku: "DOC-PRODUCT",
      categoryId: product.categoryId,
      variants: [{ sku: "DOC-V1", price: "100" }],
    });
    expect(p.status).toBe(201);
    const v = p.body.data.variants[0];
    const destination = await send(owner, "/inventory/locations", {
      name: "Secondary warehouse",
      branchId: branch.id,
    });
    expect(destination.status).toBe(201);
    const dest = destination.body.data;
    expect(
      (
        await send(cashier, "/inventory/locations", {
          name: "Denied warehouse",
          branchId: branch.id,
        })
      ).status,
    ).toBe(403);
    await send(owner, "/inventory/adjustments", {
      variantId: v.id,
      locationId: location.id,
      quantity: 10,
      cost: "40",
      reason: "Source stock",
    });
    await send(owner, "/inventory/adjustments", {
      variantId: v.id,
      locationId: dest.id,
      quantity: 2,
      cost: "20",
      reason: "Destination stock",
    });
    const input = {
        type: "TRANSFER",
        sourceId: location.id,
        destinationId: dest.id,
        reason: "Move to secondary warehouse",
        items: [{ variantId: v.id, quantity: 3 }],
      },
      key = crypto.randomUUID();
    const responses = await Promise.all([
      send(owner, "/inventory/documents", input, key),
      send(owner, "/inventory/documents", input, key),
    ]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    const doc = responses[0]!.body.data;
    expect(responses[1]!.body.data.id).toBe(doc.id);
    expect(doc.totalCost).toBe("120");
    const balance = async (locationId: string) =>
      db.stockBalance.findUniqueOrThrow({
        where: { variantId_locationId: { variantId: v.id, locationId } },
      });
    expect((await balance(location.id)).quantity).toBe(7);
    expect((await balance(dest.id)).quantity).toBe(5);
    expect((await balance(dest.id)).averageCost.toString()).toBe("32");
    const movements = await db.stockMovement.findMany({
      where: { reference: doc.id },
    });
    expect(movements).toHaveLength(2);
    expect(movements.reduce((s, m) => s + m.quantity, 0)).toBe(0);
    expect((await send(cashier, "/inventory/documents", input)).status).toBe(
      403,
    );
    const visible = await cashier.agent.get(
      "/api/inventory/documents?type=TRANSFER",
    );
    expect(visible.status).toBe(200);
    expect(
      visible.body.data.find((d: any) => d.id === doc.id).totalCost,
    ).toBeUndefined();
    expect(
      visible.body.data.find((d: any) => d.id === doc.id).items[0].unitCost,
    ).toBeUndefined();
    const before = await db.stockDocument.count();
    const fail = await send(owner, "/inventory/documents", {
      ...input,
      items: [{ variantId: v.id, quantity: 100 }],
    });
    expect(fail.status).toBe(409);
    expect(await db.stockDocument.count()).toBe(before);
    expect((await balance(location.id)).quantity).toBe(7);
    expect(
      (
        await send(owner, "/inventory/documents", {
          ...input,
          destinationId: location.id,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send(owner, "/inventory/documents", {
          ...input,
          items: [{ variantId: v.id, quantity: -1 }],
        })
      ).status,
    ).toBe(400);
    const damage = await send(owner, "/inventory/documents", {
      type: "DAMAGE",
      sourceId: dest.id,
      reason: "Manufacturing damage disposal",
      items: [{ variantId: v.id, quantity: 2 }],
    });
    expect(damage.status).toBe(201);
    expect(damage.body.data.totalCost).toBe("64");
    expect((await balance(dest.id)).quantity).toBe(3);
    const report = await owner.agent.get("/api/reports/dashboard");
    expect(report.body.data.stockDamageCost).toBe("64.00");
    await expect(
      db.stockDocument.update({
        where: { id: doc.id },
        data: { reason: "tampered" },
      }),
    ).rejects.toThrow();
    const race = await Promise.all([
      send(owner, "/inventory/documents", {
        ...input,
        items: [{ variantId: v.id, quantity: 5 }],
      }),
      send(owner, "/inventory/documents", {
        type: "DAMAGE",
        sourceId: location.id,
        reason: "Concurrent damaged stock",
        items: [{ variantId: v.id, quantity: 5 }],
      }),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await balance(location.id)).quantity).toBe(2);
    const mismatch = await db.$queryRaw<
      any[]
    >`SELECT b."variantId" FROM "StockBalance" b LEFT JOIN "StockMovement" m ON m."variantId"=b."variantId" AND m."locationId"=b."locationId" WHERE b."variantId"=${v.id}::uuid GROUP BY b."variantId",b."locationId",b.quantity HAVING b.quantity<>COALESCE(SUM(m.quantity),0)`;
    expect(mismatch).toEqual([]);
  });
  it("browser configures loyalty, redeems points and posts a warehouse transfer", async () => {
    // Browser acceptance is independent of fixture setup traffic on the same IP.
    const { apiRateLimiter } = await import("../apps/api/src/app.js");
    apiRateLimiter.resetKey("127.0.0.1");
    apiRateLimiter.resetKey("::ffff:127.0.0.1");
    const previousOrigin = process.env.APP_ORIGIN;
    const http = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => http.once("listening", r));
    const web = await preview({
      root: resolve("apps/web"),
      preview: {
        host: "127.0.0.1",
        port: await availablePort(),
        strictPort: true,
        proxy: {
          "/api": `http://127.0.0.1:${(http.address() as { port: number }).port}`,
        },
      },
    });
    const url = `http://127.0.0.1:${(web.httpServer.address() as { port: number }).port}`;
    process.env.APP_ORIGIN = url;
    const browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL ?? "msedge",
      headless: true,
    });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1100 },
      });
      expect(
        (
          await context.request.post(url + "/api/auth/login", {
            headers: { Origin: url },
            data: { email: "owner@example.test", password },
          })
        ).status(),
      ).toBe(200);
      const page = await context.newPage();
      await page.goto(url + "/settings");
      await browserExpect(
        page.getByLabel("تفعيل برنامج الولاء", { exact: true }),
      ).toBeChecked();
      await page
        .getByLabel("أقل عدد نقاط للاستبدال", { exact: true })
        .fill("1");
      await page
        .getByRole("button", { name: "حفظ إعدادات الولاء", exact: true })
        .click();
      await browserExpect(
        page.getByRole("button", { name: "حفظ إعدادات الولاء", exact: true }),
      ).toBeEnabled();
      await page.screenshot({
        path: "test-results/loyalty-settings.png",
        fullPage: true,
      });
      const customer = await db.customer.findUniqueOrThrow({
        where: { phone: "+201055443322" },
      });
      const v = await db.productVariant.findUniqueOrThrow({
        where: { sku: "LOYALTY-V1" },
      });
      await page.goto(url + "/pos");
      await page
        .getByRole("textbox", { name: "مسح الباركود", exact: true })
        .fill(v.barcode);
      await page
        .getByRole("textbox", { name: "مسح الباركود", exact: true })
        .press("Enter");
      await browserExpect(page.locator(".cart-line")).toHaveCount(1);
      await pickPosCustomer(page, customer.phone);
      await page.getByLabel("نقاط الولاء للاستبدال", { exact: true }).fill("5");
      await browserExpect(page.getByText(/المتاح: 9 نقطة/)).toBeVisible();
      await browserExpect(
        page.getByRole("button", { name: "إتمام البيع", exact: true }),
      ).toBeEnabled();
      await page.screenshot({
        path: "test-results/loyalty-pos.png",
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "إتمام البيع", exact: true })
        .click();
      await browserExpect(page.locator(".receipt-preview")).toContainText(
        "نقاط مستخدمة: 5",
      );
      await page.screenshot({
        path: "test-results/loyalty-receipt.png",
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await page.goto(url + "/inventory");
      await page
        .getByRole("button", {
          name: "التحويلات والتالف والتسويات",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "إضافة مخزن", exact: true })
        .click();
      await page
        .getByLabel("اسم المخزن", { exact: true })
        .fill("Browser warehouse");
      await page
        .getByRole("button", { name: "حفظ المخزن", exact: true })
        .click();
      await browserExpect(page.getByRole("dialog")).toHaveCount(0);
      const dest = await db.stockLocation.findFirstOrThrow({
        where: { name: "Browser warehouse" },
      });
      const docVariant = await db.productVariant.findUniqueOrThrow({
        where: { sku: "DOC-V1" },
      });
      await page
        .getByRole("button", { name: "مستند جديد", exact: true })
        .click();
      await page
        .getByLabel("المخزن المصدر", { exact: true })
        .selectOption(location.id);
      await page
        .getByLabel("المخزن الوجهة", { exact: true })
        .selectOption(dest.id);
      await page
        .getByLabel("بحث أصناف المستند", { exact: true })
        .fill("Stock document garment");
      await browserExpect(
        page
          .getByLabel("الصنف 1", { exact: true })
          .locator(`option[value="${docVariant.id}"]`),
      ).toHaveCount(1);
      await page
        .getByLabel("الصنف 1", { exact: true })
        .selectOption(docVariant.id);
      await page.getByLabel("الكمية 1", { exact: true }).fill("1");
      await page
        .getByLabel("سبب العملية", { exact: true })
        .fill("Browser warehouse transfer");
      await page.screenshot({
        path: "test-results/stock-document-form.png",
        fullPage: true,
      });
      const [postedResponse] = await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().endsWith("/api/inventory/documents") &&
            r.request().method() === "POST",
        ),
        page
          .getByRole("button", { name: "ترحيل المستند", exact: true })
          .click(),
      ]);
      expect(postedResponse.status()).toBe(201);
      const postedDocument = (await postedResponse.json()).data;
      expect(postedDocument.destinationId).toBe(dest.id);
      await browserExpect(page.getByRole("dialog")).toHaveCount(0);
      await page.screenshot({
        path: "test-results/stock-documents-after-save.png",
        fullPage: true,
      });
      const freshList = await context.request.get(
        url + "/api/inventory/documents",
      );
      expect(freshList.status()).toBe(200);
      expect(
        (await freshList.json()).data.some(
          (d: any) => d.id === postedDocument.id,
        ),
      ).toBe(true);
      await page
        .getByRole("row")
        .filter({ hasText: "Browser warehouse" })
        .getByRole("button", { name: "عرض المستند", exact: true })
        .click();
      await browserExpect(page.getByRole("dialog")).toContainText(
        "Browser warehouse transfer",
      );
      await page.screenshot({
        path: "test-results/stock-document-detail.png",
        fullPage: true,
      });
      expect(
        (
          await db.stockBalance.findUniqueOrThrow({
            where: {
              variantId_locationId: {
                variantId: docVariant.id,
                locationId: dest.id,
              },
            },
          })
        ).quantity,
      ).toBe(1);
    } finally {
      await browser.close();
      web.httpServer.closeAllConnections();
      await new Promise<void>((r) => web.httpServer.close(() => r()));
      http.closeAllConnections();
      await new Promise<void>((r) => http.close(() => r()));
      process.env.APP_ORIGIN = previousOrigin;
    }
  }, 60000);
  it("browser searches customer pages, adds a nameless phone, preserves it on reload and requires it for cash sales", async () => {
    await resetFixtureQuota();
    const previousOrigin = process.env.APP_ORIGIN;
    const http = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => http.once("listening", r));
    const web = await preview({
      root: resolve("apps/web"),
      preview: {
        host: "127.0.0.1",
        port: await availablePort(),
        strictPort: true,
        proxy: {
          "/api": `http://127.0.0.1:${(http.address() as { port: number }).port}`,
        },
      },
    });
    const url = `http://127.0.0.1:${(web.httpServer.address() as { port: number }).port}`;
    process.env.APP_ORIGIN = url;
    const browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL ?? "msedge",
      headless: true,
    });
    try {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1100 },
      });
      expect(
        (
          await context.request.post(url + "/api/auth/login", {
            headers: { Origin: url },
            data: { email: "owner@example.test", password },
          })
        ).status(),
      ).toBe(200);
      const page = await context.newPage();
      await page.goto(url + "/pos");
      const variant = await db.productVariant.findUniqueOrThrow({
        where: { sku: "LOYALTY-V1" },
      });
      await page
        .getByRole("textbox", { name: "مسح الباركود", exact: true })
        .fill(variant.barcode);
      await page
        .getByRole("textbox", { name: "مسح الباركود", exact: true })
        .press("Enter");
      await browserExpect(page.locator(".cart-line")).toHaveCount(1);
      await browserExpect(
        page.getByRole("button", { name: "إتمام البيع", exact: true }),
      ).toBeDisabled();
      const input = page.getByRole("combobox", {
        name: "رقم العميل أو الاسم",
        exact: true,
      });
      const productQueries: string[] = [];
      page.on("request", (request) => {
        const parsed = new URL(request.url());
        if (parsed.pathname === "/api/products" && parsed.searchParams.get("q"))
          productQueries.push(parsed.searchParams.get("q")!);
      });
      const productSearch = page.getByRole("textbox", {
        name: "بحث المنتجات",
        exact: true,
      });
      const [searched] = await Promise.all([
        page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === "/api/products" &&
            new URL(r.url()).searchParams.get("q") === "LOYALTY",
        ),
        productSearch.pressSequentially("LOYALTY", { delay: 20 }),
      ]);
      expect(searched.status()).toBe(200);
      expect(productQueries).toEqual(["LOYALTY"]);
      await input.fill("Many lookup");
      const options = page
        .getByRole("listbox", { name: "نتائج بحث العملاء", exact: true })
        .getByRole("option");
      await browserExpect(options).toHaveCount(10);
      const first = await options.first().textContent();
      await page
        .locator(".customer-picker-pages")
        .getByRole("button", { name: "التالي", exact: true })
        .click();
      await browserExpect(options.first()).not.toHaveText(first!);
      const customerQueries: string[] = [];
      page.on("request", (request) => {
        const parsed = new URL(request.url());
        const q = parsed.searchParams.get("q");
        if (parsed.pathname === "/api/customers" && q?.startsWith("6"))
          customerQueries.push(q);
      });
      await input.fill("");
      await input.pressSequentially("69017890", { delay: 20 });
      await browserExpect(options).toHaveCount(1);
      await browserExpect(options.first()).toContainText(
        "Formatted legacy phone",
      );
      expect(customerQueries).toEqual(["69017890"]);
      await input.fill("٠١١٧٠٠٠٠٠٥٤");
      await browserExpect(options).toHaveCount(1);
      await input.press("Enter");
      await browserExpect(
        page.locator(".customer-picker-selected"),
      ).toContainText("01170000054");
      await page
        .getByRole("button", { name: "تغيير العميل", exact: true })
        .click();
      await input.fill("٠١٢٦٠٠٠٠٠٠٢");
      await browserExpect(
        page.getByLabel("اسم العميل (اختياري)", { exact: true }),
      ).toHaveValue("");
      await browserExpect(input).toHaveAttribute("dir", "ltr");
      await browserExpect(input).toHaveCSS("text-align", "right");
      await page
        .locator(".customer-picker")
        .screenshot({ path: "test-results/customer-phone-add.png" });
      await page
        .getByRole("button", { name: "إضافة العميل واختياره", exact: true })
        .click();
      await browserExpect(
        page.locator(".customer-picker-selected"),
      ).toContainText("+201260000002");
      const c = await db.customer.findUniqueOrThrow({
        where: { phone: "+201260000002" },
      });
      expect(c.name).toBe("");
      await page.reload();
      await browserExpect(
        page.locator(".customer-picker-selected"),
      ).toContainText(c.phone);
      await page
        .locator(".customer-picker")
        .screenshot({ path: "test-results/customer-phone-selected.png" });
      await browserExpect(
        page.getByRole("button", { name: "إتمام البيع", exact: true }),
      ).toBeEnabled();
      const [posted] = await Promise.all([
        page.waitForResponse(
          (r) =>
            r.url().endsWith("/api/sales") && r.request().method() === "POST",
        ),
        page.getByRole("button", { name: "إتمام البيع", exact: true }).click(),
      ]);
      expect(posted.status()).toBe(201);
      expect(posted.request().postDataJSON()).toMatchObject({
        customerId: c.id,
        requireCustomer: true,
      });
      expect((await posted.json()).data.customerId).toBe(c.id);
      await browserExpect(page.locator(".receipt-preview")).toBeVisible();
      await page.goto(url + "/customers");
      await page.getByLabel("بحث العملاء").fill("01260000002");
      await browserExpect(
        page.getByRole("cell", { name: "بدون اسم", exact: true }),
      ).toBeVisible();
      await browserExpect(
        page.getByRole("cell", { name: c.phone, exact: true }).locator("bdi"),
      ).toHaveAttribute("dir", "ltr");
    } finally {
      await browser.close();
      web.httpServer.closeAllConnections();
      await new Promise<void>((r) => web.httpServer.close(() => r()));
      http.closeAllConnections();
      await new Promise<void>((r) => http.close(() => r()));
      process.env.APP_ORIGIN = previousOrigin;
    }
  }, 60000);
});

registerCompletionTests(() => ({
  db,
  app,
  owner,
  manager,
  cashier,
  send,
  login,
  resetFixtureQuota,
  password,
  origin: () => process.env.APP_ORIGIN ?? origin,
  availablePort,
}));
