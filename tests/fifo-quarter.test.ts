import { beforeAll, afterAll, describe, it, expect } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { mkdtemp, mkdir, writeFile, cp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import request from "supertest";
import { chromium, expect as ui } from "@playwright/test";
import { preview } from "vite";
import { createServer } from "node:net";
let db: any,
  app: any,
  pg: any,
  owner: any,
  cashier: any,
  shift: any,
  location: any,
  supplier: any,
  variant: any,
  sourceSale: any,
  quarterSnapshot: any;
const password = randomBytes(24).toString("hex"),
  origin = "http://localhost:5173";
const U = (s: string) => Number(s);
const artifactDir =
  process.env.FIFO_ARTIFACT_DIR ?? resolve("test-results/fifo-closing");
async function send(
  path: string,
  body: any,
  who = owner,
  key = crypto.randomUUID(),
) {
  return who.agent
    .post("/api" + path)
    .set("Origin", origin)
    .set("X-CSRF-Token", who.csrf)
    .set("Idempotency-Key", key)
    .send(body);
}
async function login(email: string) {
  const agent = request.agent(app);
  expect(
    (
      await agent
        .post("/api/auth/login")
        .set("Origin", origin)
        .send({ email, password })
    ).status,
  ).toBe(200);
  const me = (await agent.get("/api/auth/me")).body.data;
  return { agent, csrf: me.csrf, user: me };
}
async function sale(quantity: number, v = variant) {
  const r = await send("/sales", {
    shiftId: shift.id,
    cashierId: cashier.user.id,
    items: [{ variantId: v.id, quantity }],
    payments: [{ method: "CASH", amount: String(Number(v.price) * quantity) }],
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data;
}
async function purchase(quantity: number, cost: string, v = variant) {
  const p = await send("/purchases", {
    supplierId: supplier.id,
    locationId: location.id,
    items: [
      { variantId: v.id, quantity, unitCost: cost, salePrice: String(v.price) },
    ],
  });
  expect(p.status, JSON.stringify(p.body)).toBe(201);
  expect((await send(`/purchases/${p.body.data.id}/approve`, {})).status).toBe(
    200,
  );
  const r = await send(`/purchases/${p.body.data.id}/receive`, {
    items: [{ purchaseItemId: p.body.data.items[0].id, quantity }],
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data;
}
async function refund(s: any, quantity: number, sellable = true) {
  const r = await send(`/sales/${s.id}/returns`, {
    shiftId: shift.id,
    reason: "TEST original FIFO cost",
    reasonType: "MANUFACTURING_DEFECT",
    method: "CASH",
    items: [{ saleItemId: s.items[0].id, quantity, sellable }],
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data;
}
// Fixture-only backdating on an isolated, disposable database. The new closed-period guard remains enabled.
async function moveSale(s: any, day: string) {
  await db.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe(
      'ALTER TABLE "Sale" DISABLE TRIGGER sale_snapshot_immutable',
    );
    await tx.sale.update({
      where: { id: s.id },
      data: {
        createdAt: new Date(day),
        receiptSnapshot: { ...s.receiptSnapshot, returnDays: 365 },
      },
    });
    await tx.$executeRawUnsafe(
      'ALTER TABLE "Sale" ENABLE TRIGGER sale_snapshot_immutable',
    );
  });
}
async function moveReturn(id: string, day: string) {
  await db.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe(
      'ALTER TABLE "SaleReturn" DISABLE TRIGGER sale_returns_immutable',
    );
    await tx.saleReturn.update({
      where: { id },
      data: { createdAt: new Date(day) },
    });
    await tx.$executeRawUnsafe(
      'ALTER TABLE "SaleReturn" ENABLE TRIGGER sale_returns_immutable',
    );
  });
}
beforeAll(async () => {
  const port = await new Promise<number>((r) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as any).port;
      s.close(() => r(p));
    });
  });
  await mkdir(".test-data", { recursive: true });
  const directory = await mkdtemp(resolve(".test-data/fifo-"));
  pg = new EmbeddedPostgres({
    databaseDir: directory,
    user: "fifo_test",
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
  await pg.createDatabase("fifo_test");
  process.env.DATABASE_URL = `postgresql://fifo_test:${password}@127.0.0.1:${port}/fifo_test`;
  process.env.NODE_ENV = "test";
  process.env.APP_ORIGIN = origin;
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
  db = (await import("../apps/api/src/lib/db.js")).db;
  app = (await import("../apps/api/src/app.js")).default;
  owner = await login("owner@example.test");
  const role = await db.role.findUniqueOrThrow({ where: { name: "كاشير" } });
  const { hash } = await import("argon2");
  await db.user.create({
    data: {
      email: "cashier@example.test",
      name: "TEST Cashier",
      passwordHash: await hash(password),
      roles: { create: { roleId: role.id } },
    },
  });
  cashier = await login("cashier@example.test");
  location = await db.stockLocation.findFirstOrThrow();
  const reg = await db.register.findFirstOrThrow();
  shift = await db.cashShift.create({
    data: { registerId: reg.id, userId: owner.user.id, openingCash: 0 },
  });
  supplier = await db.supplier.create({ data: { name: "TEST Supplier" } });
  const category = await db.category.findFirstOrThrow();
  const p = await send("/products", {
    nameAr: "TEST فستان FIFO",
    sku: "FIFO-EXACT",
    categoryId: category.id,
    variants: [{ sku: "FIFO-EXACT-V", price: "171", cost: "100" }],
  });
  expect(p.status).toBe(201);
  variant = p.body.data.variants[0];
}, 180000);
afterAll(async () => {
  await db?.$disconnect();
  await pg?.stop();
}, 180000);
describe.sequential("FIFO and quarterly closing on real PostgreSQL", () => {
  it("applies the full migration to a populated legacy database and seeds exactly one opening batch", async () => {
    await pg.createDatabase("fifo_legacy");
    const url = process.env.DATABASE_URL!.replace(/fifo_test$/, "fifo_legacy");
    const stage = await mkdtemp(resolve(".test-data/legacy-schema-"));
    await cp("apps/api/prisma", stage, { recursive: true });
    await rm(stage + "/migrations/202611230010_fifo_closing", {
      recursive: true,
    });
    const env = { ...process.env, DATABASE_URL: url };
    execFileSync(
      process.execPath,
      [
        "node_modules/prisma/build/index.js",
        "migrate",
        "deploy",
        "--schema",
        stage + "/schema.prisma",
      ],
      { env, stdio: "pipe" },
    );
    execFileSync(
      process.execPath,
      ["--import", "tsx", "apps/api/prisma/initialize.ts"],
      {
        env: {
          ...env,
          INITIAL_OWNER_EMAIL: "legacy@example.test",
          INITIAL_OWNER_PASSWORD: password,
        },
        stdio: "pipe",
      },
    );
    const { PrismaClient } = await import("@prisma/client");
    const legacy = new PrismaClient({ datasourceUrl: url });
    try {
      const user = await legacy.user.findFirstOrThrow(),
        category = await legacy.category.findFirstOrThrow(),
        loc = await legacy.stockLocation.findFirstOrThrow();
      const p = await legacy.product.create({
        data: {
          nameAr: "TEST legacy stock",
          sku: "LEGACY-OPEN",
          categoryId: category.id,
          createdBy: user.id,
          variants: {
            create: {
              sku: "LEGACY-OPEN-V",
              barcode: "LEGACY-OPEN-B",
              price: 20,
              cost: "12.3456",
            },
          },
        },
        include: { variants: true },
      });
      await legacy.stockBalance.create({
        data: {
          variantId: p.variants[0]!.id,
          locationId: loc.id,
          quantity: 7,
          averageCost: "12.3456",
        },
      });
      execFileSync(
        process.execPath,
        [
          "node_modules/prisma/build/index.js",
          "migrate",
          "deploy",
          "--schema",
          "apps/api/prisma/schema.prisma",
        ],
        { env, stdio: "pipe" },
      );
      const batches = await legacy.stockBatch.findMany();
      expect(batches).toHaveLength(1);
      expect(batches[0]!.remaining).toBe(7);
      expect(batches[0]!.unitCost.toString()).toBe("12.3456");
      expect(batches[0]!.type).toBe("OPENING");
      execFileSync(
        process.execPath,
        [
          "node_modules/prisma/build/index.js",
          "migrate",
          "deploy",
          "--schema",
          "apps/api/prisma/schema.prisma",
        ],
        { env, stdio: "pipe" },
      );
      expect(await legacy.stockBatch.count()).toBe(1);
    } finally {
      await legacy.$disconnect();
    }
  });
  it("receives separate batches and sells 10 at 100 then 10 at 110, profit 900 before expenses", async () => {
    await purchase(10, "100");
    await purchase(10, "110");
    const one = await sale(10),
      two = await sale(10);
    expect(one.items[0].costTotal).toBe("1000");
    expect(two.items[0].costTotal).toBe("1100");
    expect(U(one.netBeforeTax) - U(one.items[0].costTotal)).toBe(500);
    expect(U(two.netBeforeTax) - U(two.items[0].costTotal)).toBe(400);
    await moveSale(one, "2026-07-10T10:00:00Z");
    await moveSale(two, "2026-08-10T10:00:00Z");
    sourceSale = one;
    const b = await db.stockBalance.findUniqueOrThrow({
      where: {
        variantId_locationId: {
          variantId: variant.id,
          locationId: location.id,
        },
      },
    });
    expect(b.quantity).toBe(0);
    expect(b.averageCost.toString()).toBe("0");
  });
  it("uses exact cost across two batches and returns each cost layer rather than a rounded average", async () => {
    await purchase(3, "100");
    await purchase(7, "110");
    const s = await sale(5);
    expect(s.items[0].costTotal).toBe("520");
    expect(s.items[0].unitCost).toBe("104");
    await moveSale(s, "2026-09-10T10:00:00Z");
    const r = await refund(s, 4);
    expect(r.items[0].cost).toBe("410");
    await moveReturn(r.id, "2026-09-12T10:00:00Z");
    const r2 = await refund(s, 1, false);
    expect(r2.items[0].cost).toBe("110");
    await moveReturn(r2.id, "2026-09-13T10:00:00Z");
    // The 4 sellable returns reverse 410 COGS. The unsellable unit leaves its 110 cost in the quarter.
    const rows = await db.stockBatch.findMany({ where: { reference: r.id } });
    expect(rows.map((x: any) => [x.quantity, x.unitCost.toString()])).toEqual([
      [3, "100"],
      [1, "110"],
    ]);
  });
  it("keeps old invoice snapshots when the product name and current sale price change", async () => {
    await db.productVariant.update({
      where: { id: variant.id },
      data: { price: "228" },
    });
    await db.product.update({
      where: { id: variant.productId },
      data: { nameAr: "TEST اسم جديد" },
    });
    const old = await db.sale.findUniqueOrThrow({
      where: { id: sourceSale.id },
      include: { items: true },
    });
    expect(old.items[0].unitPrice.toString()).toBe("171");
    expect(old.items[0].name).toContain("فستان FIFO");
    expect(old.items[0].costTotal.toString()).toBe("1000");
  });
  it("prevents overselling and keeps batches unchanged on rollback", async () => {
    const before = await db.stockBatch.findMany({
      where: { variantId: variant.id },
      orderBy: { id: "asc" },
    });
    const r = await send("/sales", {
      shiftId: shift.id,
      cashierId: cashier.user.id,
      items: [{ variantId: variant.id, quantity: 1000 }],
      payments: [{ method: "CASH", amount: "228000" }],
    });
    expect(r.status).toBe(409);
    expect(
      await db.stockBatch.findMany({
        where: { variantId: variant.id },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before);
  });
  it("includes only approved period expenses and validates partner percentages and permissions", async () => {
    await db.expense.create({
      data: {
        category: "إيجار",
        status: "APPROVED",
        amount: "90",
        method: "CARD",
        description: "TEST quarter expense",
        createdBy: owner.user.id,
        date: new Date("2026-08-15T10:00:00Z"),
      },
    });
    await db.expense.create({
      data: {
        category: "إيجار",
        status: "REJECTED",
        amount: "999",
        method: "CARD",
        description: "TEST rejected",
        createdBy: owner.user.id,
        date: new Date("2026-08-15T10:00:00Z"),
      },
    });
    expect(
      (
        await send("/accounting/partners", [
          { name: "TEST شريك أول", percent: "60" },
          { name: "TEST شريك ثان", percent: "30" },
        ])
      ).status,
    ).toBe(400);
    expect(
      (
        await send("/accounting/partners", [
          { name: "TEST شريك أول", percent: "60" },
          { name: "TEST شريك ثان", percent: "40" },
        ])
      ).status,
    ).toBe(200);
    expect(
      (await cashier.agent.get("/api/accounting/period?year=2026&quarter=3"))
        .status,
    ).toBe(403);
    const r = await owner.agent.get(
      "/api/accounting/period?year=2026&quarter=3",
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    quarterSnapshot = r.body.data;
    expect(quarterSnapshot.figures.netSales).toBe("3000.00");
    expect(quarterSnapshot.figures.costOfGoodsSold).toBe("2210.00");
    expect(quarterSnapshot.figures.expenses).toBe("90.00");
    expect(quarterSnapshot.figures.netProfit).toBe("700.00");
    expect(quarterSnapshot.partners.map((p: any) => p.share)).toEqual([
      "420.00",
      "280.00",
    ]);
  });
  it("blocks pending expenses, future quarters and closes once with an immutable snapshot", async () => {
    expect(
      (
        await send("/accounting/close", {
          year: 2026,
          quarter: 4,
          confirm: true,
        })
      ).status,
    ).toBe(409);
    const pending = await db.expense.create({
      data: {
        category: "إيجار",
        status: "PENDING",
        amount: "10",
        method: "CARD",
        description: "TEST pending",
        createdBy: owner.user.id,
        date: new Date("2026-08-15T10:00:00Z"),
      },
    });
    expect(
      (
        await send("/accounting/close", {
          year: 2026,
          quarter: 3,
          confirm: true,
        })
      ).status,
    ).toBe(409);
    await db.expense.update({
      where: { id: pending.id },
      data: { status: "REJECTED", decidedBy: cashier.user.id },
    });
    const a = await send("/accounting/close", {
      year: 2026,
      quarter: 3,
      confirm: true,
    });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body.data.closed).toBe(true);
    const b = await send("/accounting/close", {
      year: 2026,
      quarter: 3,
      confirm: true,
    });
    expect(b.body.data.id).toBe(a.body.data.id);
    await expect(
      db.accountingClose.update({
        where: { id: a.body.data.id },
        data: { snapshot: {} },
      }),
    ).rejects.toThrow();
  });
  it("blocks direct edits, deletes and new backdated financial rows in the closed quarter", async () => {
    await expect(
      db.sale.update({ where: { id: sourceSale.id }, data: { total: "1" } }),
    ).rejects.toThrow("ACCOUNTING_PERIOD_CLOSED");
    await expect(
      db.sale.update({
        where: { id: sourceSale.id },
        data: { createdAt: new Date() },
      }),
    ).rejects.toThrow("ACCOUNTING_PERIOD_CLOSED");
    await expect(
      db.saleItem.update({
        where: { id: sourceSale.items[0].id },
        data: { unitCost: "1" },
      }),
    ).rejects.toThrow("ACCOUNTING_PERIOD_CLOSED");
    await expect(
      db.saleItem.delete({ where: { id: sourceSale.items[0].id } }),
    ).rejects.toThrow();
    await expect(
      db.expense.create({
        data: {
          category: "إيجار",
          status: "APPROVED",
          amount: "10",
          method: "CARD",
          description: "TEST forbidden",
          createdBy: owner.user.id,
          date: new Date("2026-08-15T10:00:00Z"),
        },
      }),
    ).rejects.toThrow("ACCOUNTING_PERIOD_CLOSED");
  });
  it("posts a late return to the current quarter at the original cost without changing the closed quarter", async () => {
    const r = await refund(
      {
        ...sourceSale,
        receiptSnapshot: { ...sourceSale.receiptSnapshot, returnDays: 365 },
      },
      1,
    );
    expect(r.items[0].cost).toBe("100");
    const q = (
      await owner.agent.get("/api/accounting/period?year=2026&quarter=3")
    ).body.data;
    expect(q.figures).toEqual(quarterSnapshot.figures);
    await send("/accounting/partners", [
      { name: "TEST Changed", percent: "100" },
    ]);
    expect(
      (
        await owner.agent.get("/api/accounting/period?year=2026&quarter=3")
      ).body.data.partners.map((p: any) => p.share),
    ).toEqual(["420.00", "280.00"]);
  });
  it("migrates an existing positive balance at its exact average without changing historical costs", async () => {
    const category = await db.category.findFirstOrThrow();
    const product = await db.product.create({
      data: {
        nameAr: "TEST opening migration",
        sku: "OPENING-MIGRATION",
        categoryId: category.id,
        createdBy: owner.user.id,
        variants: {
          create: {
            sku: "OPENING-MIGRATION-V",
            barcode: "OPENING-MIGRATION-B",
            price: 20,
            cost: "12.3456",
          },
        },
      },
      include: { variants: true },
    });
    const v = product.variants[0];
    await db.stockBalance.create({
      data: {
        variantId: v.id,
        locationId: location.id,
        quantity: 7,
        averageCost: "12.3456",
      },
    });
    await db.$executeRaw`INSERT INTO "StockBatch" (id,"variantId","locationId",quantity,remaining,"unitCost","acquiredAt",reference,type) SELECT gen_random_uuid(),"variantId","locationId",quantity,quantity,"averageCost",CURRENT_TIMESTAMP,'FIFO-OPENING','OPENING' FROM "StockBalance" WHERE "variantId"=${v.id}::uuid AND quantity>0`;
    const batches = await db.stockBatch.findMany({
      where: { variantId: v.id },
    });
    expect(batches).toHaveLength(1);
    expect(batches[0].unitCost.toString()).toBe("12.3456");
    expect(batches[0].remaining).toBe(7);
    const sold = await sale(3, v);
    expect(sold.items[0].costTotal).toBe("37.0368");
    await expect(
      db.saleItem.update({
        where: { id: sold.items[0].id },
        data: { costTotal: 1 },
      }),
    ).rejects.toThrow("Posted FIFO cost is immutable");
    await expect(
      db.stockBatch.update({
        where: { id: batches[0].id },
        data: { unitCost: 1 },
      }),
    ).rejects.toThrow("FIFO batch identity and cost are immutable");
  });
  it("preserves mixed batch costs across partial shipping, quarantine disposal/release and adjustments", async () => {
    const category = await db.category.findFirstOrThrow();
    const p = await send("/products", {
      nameAr: "TEST mixed stock",
      sku: "MIXED-STOCK",
      categoryId: category.id,
      variants: [{ sku: "MIXED-STOCK-V", price: "50", cost: "10" }],
    });
    const v = p.body.data.variants[0];
    await purchase(2, "10", v);
    await purchase(4, "20", v);
    const destination = await db.stockLocation.create({
      data: { branchId: location.branchId, name: "TEST FIFO destination" },
    });
    const shipped = await send("/inventory/shipments", {
      sourceId: location.id,
      destinationId: destination.id,
      reason: "TEST mixed FIFO shipping",
      items: [{ variantId: v.id, quantity: 4 }],
    });
    expect(shipped.status).toBe(201);
    const shipment = shipped.body.data;
    expect(
      (
        await send(`/inventory/shipments/${shipment.id}/receive`, {
          items: [{ itemId: shipment.items[0].id, quantity: 3 }],
        })
      ).status,
    ).toBe(200);
    let batches = await db.stockBatch.findMany({
      where: { locationId: destination.id, variantId: v.id },
      orderBy: { unitCost: "asc" },
    });
    expect(
      batches.map((b: any) => [b.remaining, b.unitCost.toString()]),
    ).toEqual([
      [2, "10"],
      [1, "20"],
    ]);
    expect(
      (
        await send(`/inventory/shipments/${shipment.id}/receive`, {
          items: [{ itemId: shipment.items[0].id, quantity: 1 }],
        })
      ).status,
    ).toBe(200);
    const held = await send("/inventory/holds", {
      locationId: destination.id,
      variantId: v.id,
      quantity: 4,
      reason: "TEST FIFO quarantine",
    });
    expect(held.status).toBe(201);
    const hold = held.body.data;
    expect(
      (
        await send(`/inventory/holds/${hold.id}/resolve`, {
          action: "DISPOSE",
          quantity: 1,
          reason: "TEST dispose oldest",
        })
      ).status,
    ).toBe(200);
    const damage = await db.stockDocument.findFirstOrThrow({
      where: { sourceId: destination.id, type: "DAMAGE" },
    });
    expect(damage.totalCost.toString()).toBe("10");
    expect(
      (
        await send(`/inventory/holds/${hold.id}/resolve`, {
          action: "RELEASE",
          quantity: 3,
          reason: "TEST release remaining",
        })
      ).status,
    ).toBe(200);
    batches = await db.stockBatch.findMany({
      where: {
        locationId: destination.id,
        variantId: v.id,
        remaining: { gt: 0 },
      },
      orderBy: { unitCost: "asc" },
    });
    expect(
      batches.map((b: any) => [b.remaining, b.unitCost.toString()]),
    ).toEqual([
      [1, "10"],
      [1, "20"],
      [1, "20"],
    ]);
    const adjustment = await send("/inventory/documents", {
      type: "ADJUSTMENT",
      sourceId: destination.id,
      reason: "TEST negative FIFO adjustment",
      items: [{ variantId: v.id, quantity: -2 }],
    });
    expect(adjustment.status).toBe(201);
    expect(adjustment.body.data.totalCost).toBe("-30");
    const balance = await db.stockBalance.findUniqueOrThrow({
      where: {
        variantId_locationId: { variantId: v.id, locationId: destination.id },
      },
    });
    expect(balance.quantity).toBe(1);
    expect(balance.averageCost.toString()).toBe("20");
  });
  it("serializes concurrent attempts to sell the last piece and allocates loss shares to exact cents", async () => {
    const category = await db.category.findFirstOrThrow();
    const p = await send("/products", {
      nameAr: "TEST concurrent FIFO",
      sku: "FIFO-RACE",
      categoryId: category.id,
      variants: [{ sku: "FIFO-RACE-V", price: "22.80", cost: "10" }],
    });
    const v = p.body.data.variants[0];
    await purchase(1, "10", v);
    const body = {
      shiftId: shift.id,
      cashierId: cashier.user.id,
      items: [{ variantId: v.id, quantity: 1 }],
      payments: [{ method: "CASH", amount: "22.80" }],
    };
    const race = await Promise.all([
      send("/sales", body),
      send("/sales", body),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      (
        await db.stockBalance.findUniqueOrThrow({
          where: {
            variantId_locationId: { variantId: v.id, locationId: location.id },
          },
        })
      ).quantity,
    ).toBe(0);
    await send("/accounting/partners", [
      { name: "TEST A", percent: "33.33" },
      { name: "TEST B", percent: "33.33" },
      { name: "TEST C", percent: "33.34" },
    ]);
    await db.expense.create({
      data: {
        category: "إيجار",
        status: "APPROVED",
        amount: "0.01",
        method: "CARD",
        description: "TEST loss rounding",
        createdBy: owner.user.id,
        date: new Date("2026-04-15T10:00:00Z"),
      },
    });
    const loss = (
      await owner.agent.get("/api/accounting/period?year=2026&quarter=2")
    ).body.data;
    expect(loss.figures.netProfit).toBe("-0.01");
    expect(
      loss.partners
        .map((p: any) => Number(p.share))
        .reduce((a: number, b: number) => a + b, 0),
    ).toBe(-0.01);
  });

  it("repeats the exact 900-profit example in a separate historical quarter and verifies Cairo quarter boundaries", async () => {
    const category = await db.category.findFirstOrThrow();
    const p = await send("/products", {
      nameAr: "TEST مثال ربح 900",
      sku: "FIFO-900",
      categoryId: category.id,
      variants: [{ sku: "FIFO-900-V", price: "171", cost: "100" }],
    });
    const v = p.body.data.variants[0];
    await purchase(10, "100", v);
    await purchase(10, "110", v);
    const first = await sale(10, v),
      second = await sale(10, v);
    await moveSale(first, "2026-01-10T10:00:00Z");
    await moveSale(second, "2026-03-10T10:00:00Z");
    const q = (
      await owner.agent.get("/api/accounting/period?year=2026&quarter=1")
    ).body.data;
    expect(q.figures.netSales).toBe("3000.00");
    expect(q.figures.costOfGoodsSold).toBe("2100.00");
    expect(q.figures.netProfit).toBe("900.00");
    const { quarterBounds } =
      await import("../apps/api/src/routes/accounting.js");
    expect(quarterBounds(2026, 1).startsAt.toISOString()).toBe(
      "2025-12-31T22:00:00.000Z",
    );
    expect(quarterBounds(2026, 3).startsAt.toISOString()).toBe(
      "2026-06-30T21:00:00.000Z",
    );
    expect(quarterBounds(2026, 3).endsAt.toISOString()).toBe(
      "2026-09-30T21:00:00.000Z",
    );
  });

  it("derives VAT comparisons without changing profit or partner basis, including old saved figures and negative VAT", async () => {
    const { profitTaxViews } =
      await import("../apps/api/src/routes/accounting.js");
    expect(profitTaxViews({ netProfit: "700.00", tax: "420.00" })).toEqual({
      netProfit: "700.00",
      tax: "420.00",
      profitPlusSalesVat: "1120.00",
      profitMinusSalesVat: "280.00",
    });
    expect(
      profitTaxViews({ netProfit: "-50.00", tax: "-21.00" }),
    ).toMatchObject({
      profitPlusSalesVat: "-71.00",
      profitMinusSalesVat: "-29.00",
    });
    const q = (
      await owner.agent.get("/api/accounting/period?year=2026&quarter=3")
    ).body.data;
    expect(q.figures.netProfit).toBe("700.00");
    expect(q.figures.tax).toBe("420.00");
    expect(q.figures.profitPlusSalesVat).toBe("1120.00");
    expect(q.figures.profitMinusSalesVat).toBe("280.00");
    expect(q.partners.map((p: any) => p.share)).toEqual(["420.00", "280.00"]);
  });
  it("paginates all inventory batches beyond 200 with stable ordering and bounded page sizes", async () => {
    await db.stockBatch.createMany({
      data: Array.from({ length: 211 }, (_, i) => ({
        variantId: variant.id,
        locationId: location.id,
        quantity: 1,
        remaining: 0,
        unitCost: "1",
        reference: `TEST-PAGING-${i}`,
        type: "TEST",
        acquiredAt: new Date("2030-01-01T00:00:00Z"),
      })),
    });
    const total = await db.stockBatch.count();
    const ids: string[] = [];
    for (let page = 1; page <= Math.ceil(total / 25); page++) {
      const r = await owner.agent.get(
        `/api/accounting/batches?page=${page}&pageSize=25`,
      );
      expect(r.status).toBe(200);
      expect(r.body.total).toBe(total);
      expect(r.body.data.length).toBeLessThanOrEqual(25);
      ids.push(...r.body.data.map((b: any) => b.id));
    }
    expect(ids.length).toBe(total);
    expect(new Set(ids).size).toBe(total);
    expect(total).toBeGreaterThan(200);
    for (const pageSize of [25, 50, 100, 150]) {
      const r = await owner.agent.get(
        `/api/accounting/batches?page=1&pageSize=${pageSize}`,
      );
      expect(r.status).toBe(200);
      expect(r.body.pageSize).toBe(pageSize);
      expect(r.body.data.length).toBe(pageSize);
    }
    expect(
      (await owner.agent.get("/api/accounting/batches?pageSize=200")).status,
    ).toBe(400);
    expect(
      (await owner.agent.get("/api/accounting/batches?page=0&pageSize=25"))
        .status,
    ).toBe(400);
    expect(
      (await cashier.agent.get("/api/accounting/batches?page=1&pageSize=25"))
        .status,
    ).toBe(403);
  });
  it("renders the actual local reports UI with the closed numbers and captures PC screenshots", async () => {
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    const port = (server.address() as any).port;
    const web = await preview({
      root: resolve("apps/web"),
      preview: {
        host: "127.0.0.1",
        port: 0,
        proxy: { "/api": `http://127.0.0.1:${port}` },
      },
    });
    const url = `http://127.0.0.1:${(web.httpServer.address() as any).port}`;
    process.env.APP_ORIGIN = url;
    const browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL ?? "chrome",
      headless: true,
    });
    try {
      const context = await browser.newContext({
        viewport: { width: 1600, height: 1100 },
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(url + "/reports");
      await page.getByLabel("البريد الإلكتروني").fill("owner@example.test");
      await page.getByLabel("كلمة المرور", { exact: true }).fill(password);
      await page.getByRole("button", { name: "تسجيل الدخول" }).click();
      await page.waitForURL("**/dashboard");
      await page.goto(url + "/reports");
      await ui(
        page.getByRole("heading", { name: "التقارير التفصيلية", exact: true }),
      ).toBeVisible();
      await ui(
        page.getByRole("heading", {
          name: "إقفال الأرباح ربع السنوي",
          exact: true,
        }),
      ).toHaveCount(0);
      await page
        .locator(".sidebar")
        .getByRole("link", { name: "إقفال الأرباح ربع السنوي", exact: true })
        .click();
      await ui(page).toHaveURL(url + "/quarterly-closing");
      await ui(
        page.getByRole("heading", {
          name: "إقفال الأرباح ربع السنوي",
          exact: true,
        }),
      ).toBeVisible();
      await ui(
        page.getByRole("heading", { name: "التقارير التفصيلية", exact: true }),
      ).toHaveCount(0);
      await page.getByLabel("سنة الإقفال").fill("2026");
      await page.getByLabel("ربع الإقفال").selectOption("3");
      await ui(page.getByTestId("quarter-netProfit")).toHaveText("700.00 EGP");
      await ui(page.getByTestId("quarter-tax")).toHaveText("420.00 EGP");
      await ui(page.getByTestId("quarter-profitPlusSalesVat")).toHaveText(
        "1,120.00 EGP",
      );
      await ui(page.getByTestId("quarter-profitMinusSalesVat")).toHaveText(
        "280.00 EGP",
      );
      await ui(
        page.getByText("الفترة مقفلة، الأرقام محفوظة", { exact: true }),
      ).toBeVisible();
      await mkdir(artifactDir, { recursive: true });
      await ui(page.getByLabel("اسم الشريك 1", { exact: true })).toBeHidden();
      await page.screenshot({
        path: artifactDir + "/partners-collapsed-desktop.png",
        fullPage: true,
      });
      await page
        .getByRole("button", { name: /إعداد أسماء الشركاء ونسبهم/ })
        .click();
      // Real persisted partner setup, without changing the closed Q3 snapshot.
      await page.getByLabel("حذف الشريك 3", { exact: true }).click();
      await ui(page.locator("#partner-settings-title")).toBeVisible();
      await page
        .getByLabel("اسم الشريك 1", { exact: true })
        .fill("شريك تجريبي أول");
      await page.getByLabel("نسبة الشريك 1", { exact: true }).fill("55");
      await page
        .getByLabel("اسم الشريك 2", { exact: true })
        .fill("شريك تجريبي ثان");
      await page.getByLabel("نسبة الشريك 2", { exact: true }).fill("40");
      await ui(
        page.getByRole("button", {
          name: "حفظ أسماء الشركاء ونسبهم",
          exact: true,
        }),
      ).toBeDisabled();
      await ui(
        page.getByText("مجموع نسب الشركاء لازم يساوي 100%.", { exact: true }),
      ).toBeVisible();
      await page.getByLabel("نسبة الشريك 2", { exact: true }).fill("45");
      await page
        .getByRole("button", { name: "حفظ أسماء الشركاء ونسبهم", exact: true })
        .click();
      await ui(
        page.getByText(/تم حفظ أسماء الشركاء ونسبهم بنجاح/),
      ).toBeVisible();
      expect(
        (await owner.agent.get("/api/accounting/partners")).body.data,
      ).toEqual([
        { name: "شريك تجريبي أول", percent: "55" },
        { name: "شريك تجريبي ثان", percent: "45" },
      ]);
      const unchanged = (
        await owner.agent.get("/api/accounting/period?year=2026&quarter=3")
      ).body.data;
      expect(unchanged.partners).toEqual(quarterSnapshot.partners);
      const footer = page.locator(".partner-settings-actions");
      const totalRow = page.locator(".partner-settings-total");
      expect((await footer.boundingBox())!.y).toBeGreaterThan(
        (await totalRow.boundingBox())!.y +
          (await totalRow.boundingBox())!.height,
      );
      await page.screenshot({
        path: artifactDir + "/partner-settings-desktop.png",
        fullPage: true,
      });
      await page.reload();
      await page
        .getByRole("button", { name: /إعداد أسماء الشركاء ونسبهم/ })
        .click();
      await ui(page.getByLabel("اسم الشريك 1", { exact: true })).toHaveValue(
        "شريك تجريبي أول",
      );
      await ui(page.getByLabel("نسبة الشريك 2", { exact: true })).toHaveValue(
        "45",
      );
      await page
        .getByRole("button", { name: "إضافة شريك", exact: true })
        .click();
      await ui(page.getByLabel("اسم الشريك 3", { exact: true })).toBeVisible();
      await page.getByLabel("حذف الشريك 3", { exact: true }).click();
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.reload();
        await page.getByLabel("ربع الإقفال").selectOption("3");
        await ui(page.getByTestId("quarter-netProfit")).toHaveText(
          "700.00 EGP",
        );
        await page.screenshot({
          path: artifactDir + `/partners-collapsed-${width}.png`,
          fullPage: true,
        });
        await page
          .getByRole("button", { name: /إعداد أسماء الشركاء ونسبهم/ })
          .click();
        await ui(page.getByLabel("اسم الشريك 1", { exact: true })).toHaveValue(
          "شريك تجريبي أول",
        );
        await page.locator("#partner-settings-title").scrollIntoViewIfNeeded();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: artifactDir + `/partner-settings-${width}.png`,
          fullPage: true,
        });
      }
      await page.setViewportSize({ width: 1600, height: 1100 });
      await page.getByLabel("ربع الإقفال").selectOption("2");
      const openShares = (
        await owner.agent.get("/api/accounting/period?year=2026&quarter=2")
      ).body.data.partners;
      expect(openShares.map((p: any) => p.percent)).toEqual(["55", "45"]);
      await page.getByLabel("ربع الإقفال").selectOption("3");
      await page.screenshot({
        path: artifactDir + "/quarter-tax-comparison.png",
        fullPage: true,
      });
      await page.getByText("دفعات المخزون وتكلفتها", { exact: true }).click();
      await page
        .getByText("دفعات المخزون وتكلفتها", { exact: true })
        .scrollIntoViewIfNeeded();
      await page.getByLabel("عدد العناصر في الصفحة").selectOption("150");
      await ui(page.getByText(/1–150 من/)).toBeVisible();
      await page.getByRole("button", { name: "التالي", exact: true }).click();
      await ui(page.getByText(/151–/)).toBeVisible();
      await page.screenshot({
        path: artifactDir + "/fifo-batches.png",
        fullPage: true,
      });
      await page.getByText("دفعات المخزون وتكلفتها", { exact: true }).click();
      await page.getByText("دفعات المخزون وتكلفتها", { exact: true }).click();
      await page
        .getByRole("navigation", { name: "التنقل بين الصفحات" })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: artifactDir + "/batches-pagination-desktop.png",
        fullPage: false,
      });
      await page.setViewportSize({ width: 390, height: 1000 });
      await page.reload();
      await page.getByText("دفعات المخزون وتكلفتها", { exact: true }).click();
      await page.getByLabel("عدد العناصر في الصفحة").selectOption("150");
      await ui(page.getByText(/1–150 من/)).toBeVisible();
      await page.getByRole("button", { name: "التالي", exact: true }).click();
      await ui(page.getByText(/151–/)).toBeVisible();
      await page
        .getByRole("navigation", { name: "التنقل بين الصفحات" })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: artifactDir + "/batches-pagination-mobile.png",
        fullPage: false,
      });
      await page.setViewportSize({ width: 1600, height: 1100 });
      await page.getByText("دفعات المخزون وتكلفتها", { exact: true }).click();
      // Exercise the real UI confirmation and close action, not a mocked response.
      await page.getByLabel("ربع الإقفال").selectOption("2");
      await ui(page.getByTestId("quarter-netProfit")).toHaveText("-0.01 EGP");
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "إقفال الفترة نهائيًا" }).click();
      await ui(
        page.getByText("الفترة مقفلة، الأرقام محفوظة", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: artifactDir + "/loss-quarter-closed.png",
        fullPage: false,
      });
      await page.getByLabel("ربع الإقفال").selectOption("3");
      await ui(page.getByTestId("quarter-netProfit")).toHaveText("700.00 EGP");
      await page.getByLabel("ربع الإقفال").selectOption("1");
      await ui(page.getByTestId("quarter-netProfit")).toHaveText("900.00 EGP");
      await ui(page.getByTestId("quarter-costOfGoodsSold")).toHaveText(
        "2,100.00 EGP",
      );
      await ui(
        page.getByText("تم إقفال الفترة وتجميد الأرقام", { exact: true }),
      ).toBeHidden({ timeout: 15000 });
      await page.screenshot({
        path: artifactDir + "/fifo-example-900.png",
        fullPage: false,
      });
      // A cashier cannot see the navigation item or open the protected page.
      const denied = await browser.newContext();
      const deniedPage = await denied.newPage();
      await deniedPage.goto(url + "/quarterly-closing");
      await deniedPage
        .getByLabel("البريد الإلكتروني")
        .fill("cashier@example.test");
      await deniedPage
        .getByLabel("كلمة المرور", { exact: true })
        .fill(password);
      await deniedPage.getByRole("button", { name: "تسجيل الدخول" }).click();
      await deniedPage.waitForURL("**/dashboard");
      await deniedPage.goto(url + "/quarterly-closing");
      await ui(deniedPage.getByLabel("سنة الإقفال")).toHaveCount(0);
      await ui(
        deniedPage
          .locator(".sidebar")
          .getByRole("link", { name: "إقفال الأرباح ربع السنوي", exact: true }),
      ).toHaveCount(0);
      await denied.close();
      expect(errors).toEqual([]);
      await writeFile(
        artifactDir + "/verified-numbers.json",
        JSON.stringify(quarterSnapshot, null, 2),
      );
    } finally {
      await browser.close();
      await new Promise<void>((r) => web.httpServer.close(() => r()));
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
