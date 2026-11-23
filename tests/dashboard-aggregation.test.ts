import { beforeAll, afterAll, describe, it, expect } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { PrismaClient } from "@prisma/client";
import { dashboardData } from "../apps/api/src/controllers/reports.controller.js";
import { legacyDashboardData } from "./fixtures/dashboard-legacy.js";
import { D, totals } from "../apps/api/src/utils/money.js";

let pg: EmbeddedPostgres, db: PrismaClient;
const users = [randomUUID(), randomUUID(), randomUUID()];
const branches = [randomUUID(), randomUUID()];
const locations = [randomUUID(), randomUUID()];
const shifts = [randomUUID(), randomUUID()];
const variantId = randomUUID();
const from = new Date("2026-01-01T00:00:00Z");
const to = new Date("2026-12-31T23:59:59.999Z");
const asActor = (permissions: string[], id = users[0]) =>
  ({ id, permissions }) as Parameters<typeof dashboardData>[1];
// Tied cashier totals have no specified order in the legacy findMany queries.
// Compare every cashier field by identity, and assert descending total separately.
function normalized(value: any) {
  return {
    ...value,
    cashiers: [...value.cashiers].sort((a, b) => a.id.localeCompare(b.id)),
  };
}
async function compare(
  permissions: string[],
  start = from,
  end = to,
  id = users[0],
  timezone = "UTC",
) {
  const actor = asActor(permissions, id);
  const [oldResult, newResult] = await db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT set_config('TimeZone', ${timezone}, true)`;
      return [
        await legacyDashboardData(tx, actor, start, end),
        await dashboardData(tx, actor, start, end),
      ];
    },
    { isolationLevel: "RepeatableRead", timeout: 120000 },
  );
  expect(normalized(newResult)).toEqual(normalized(oldResult));
  expect(newResult.cashiers.map((c: any) => Number(c.grossSales))).toEqual(
    newResult.cashiers
      .map((c: any) => Number(c.grossSales))
      .sort((a: number, b: number) => b - a),
  );
  return newResult;
}
beforeAll(async () => {
  const port = await new Promise<number>((done) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => done(port));
    });
  });
  await mkdir(".test-data", { recursive: true });
  pg = new EmbeddedPostgres({
    databaseDir: await mkdtemp(resolve(".test-data/dashboard-")),
    user: "az_test",
    password: randomBytes(24).toString("hex"),
    port,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-h", "127.0.0.1"],
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("dashboard");
  // Use the driver's connection settings rather than any external database.
  const client = pg.getPgClient("dashboard");
  const params = client.connectionParameters;
  process.env.DATABASE_URL = `postgresql://${params.user}:${params.password}@127.0.0.1:${port}/dashboard`;
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
  db = new PrismaClient();
  await db.user.createMany({
    data: users.map((id, i) => ({
      id,
      email: `u${i}@example.test`,
      name: "Same name",
      employeeCode: i === 1 ? null : `EMP${i}`,
      passwordHash: "test-only",
    })),
  });
  for (let i = 0; i < 2; i++) {
    await db.branch.create({ data: { id: branches[i], name: `Branch ${i}` } });
    await db.stockLocation.create({
      data: { id: locations[i], branchId: branches[i], name: `Location ${i}` },
    });
    const register = await db.register.create({
      data: {
        name: `Register ${i}`,
        branchId: branches[i],
        locationId: locations[i],
      },
    });
    await db.cashShift.create({
      data: {
        id: shifts[i],
        userId: users[i],
        registerId: register.id,
        openingCash: 0,
      },
    });
  }
  const category = await db.category.create({ data: { name: "Test" } });
  const product = await db.product.create({
    data: {
      nameAr: "Test",
      sku: "test",
      categoryId: category.id,
      createdBy: users[0],
    },
  });
  await db.productVariant.create({
    data: {
      id: variantId,
      productId: product.id,
      sku: "test",
      barcode: "test",
      price: 114,
      minStock: 2,
    },
  });
  const instants = [
    new Date(from.getTime() - 1),
    from,
    new Date("2026-04-23T21:59:59.999Z"),
    new Date("2026-04-23T22:00:00Z"),
    new Date("2026-07-14T20:59:59.999Z"),
    new Date("2026-07-14T21:00:00Z"),
    new Date("2026-10-29T20:59:59.999Z"),
    new Date("2026-10-29T21:00:00Z"),
    to,
    new Date(to.getTime() + 1),
  ];
  for (let i = 0; i < 120; i++) {
    const inclusive = i % 2 === 0;
    const rate = ["0", "14", "5", "14.1250"][Math.floor(i / 2) % 4];
    const quantity = (i % 4) + 1;
    const price = D("19.99").plus(i);
    const amounts = totals(
      [{ price: price.toFixed(2), quantity }],
      (i % 7).toFixed(2),
      rate,
      inclusive ? "INCLUSIVE" : "EXCLUSIVE",
    );
    const sale = await db.sale.create({
      data: {
        userId: users[i % 3],
        branchId: branches[i % 2],
        shiftId: shifts[i % 2],
        ...amounts,
        taxRate: rate,
        taxMode: inclusive ? "INCLUSIVE" : "EXCLUSIVE",
        change: 0,
        createdAt: instants[i % instants.length],
        status: i % 5 ? "COMPLETED" : "RETURNED",
        items: {
          create: {
            variantId,
            name: "Test",
            options: {},
            barcode: "test",
            unitPrice: price,
            unitCost: "7.1234",
            quantity,
            discount: amounts.discount,
            tax: amounts.tax,
            total: amounts.total,
          },
        },
        // Partial payments and mixed methods must not multiply or reduce totals.
        payments: {
          create: [
            { method: "CASH", amount: "1.25" },
            { method: "CARD", amount: "2.50" },
          ],
        },
      },
      include: { items: true },
    });
    if (i % 3 === 0 || i === 10)
      await db.saleReturn.create({
        data: {
          saleId: sale.id,
          shiftId: shifts[0],
          createdBy: users[1],
          reason: "test",
          method: "CASH",
          total: "10.13",
          refundAmount: "10.13",
          createdAt: i % 2 ? from : new Date("2026-07-14T21:00:00Z"),
          items: {
            create: {
              saleItemId: sale.items[0].id,
              quantity: 1,
              sellable: i % 2 === 0,
              amount: "10.13",
              tax: "1.24",
              cost: "7.1234",
            },
          },
        },
      });
  }
  await db.expenseCategory.create({ data: { name: "test" } });
  await db.expense.createMany({
    data: ["APPROVED", "PENDING", "REJECTED"].map((status, i) => ({
      status,
      category: "test",
      amount: 10 + i,
      method: "CASH",
      description: "test",
      createdBy: users[0],
      date: from,
    })),
  });
  await db.stockDocument.createMany({
    data: ["DAMAGE", "TRANSFER"].map((type) => ({
      type,
      sourceId: locations[0],
      destinationId: type === "TRANSFER" ? locations[1] : null,
      reason: "test",
      totalCost: "12.34",
      createdBy: users[0],
      createdAt: to,
    })),
  });
  await db.stockBalance.createMany({
    data: locations.map((locationId, i) => ({
      locationId,
      variantId,
      quantity: i ? 7 : 2,
      averageCost: "7.1234",
    })),
  });
  for (const status of ["SHIPPED", "PARTIAL", "RECEIVED"])
    await db.shipment.create({
      data: {
        sourceId: locations[0],
        destinationId: locations[1],
        status,
        reason: "test",
        createdBy: users[0],
        items: {
          create: { variantId, quantity: 8, received: 3, unitCost: "7.1234" },
        },
      },
    });
  await db.stockHold.create({
    data: {
      locationId: locations[0],
      variantId,
      quantity: 7,
      released: 1,
      disposed: 2,
      unitCost: "7.1234",
      reason: "test",
      createdBy: users[0],
    },
  });
  const supplier = await db.supplier.create({ data: { name: "Test" } });
  const purchase = await db.purchaseOrder.create({
    data: {
      supplierId: supplier.id,
      locationId: locations[0],
      createdBy: users[0],
      items: { create: { variantId, quantity: 10, unitCost: "7.1234" } },
    },
    include: { items: true },
  });
  const receipt = await db.purchaseReceipt.create({
    data: {
      purchaseId: purchase.id,
      createdBy: users[0],
      total: "71.23",
      items: {
        create: {
          purchaseItemId: purchase.items[0].id,
          quantity: 10,
          unitCost: "7.1234",
          lineTotal: "71.23",
        },
      },
    },
    include: { items: true },
  });
  const invoice = await db.supplierInvoice.create({
    data: {
      supplierId: supplier.id,
      receiptId: receipt.id,
      total: "71.23",
      createdBy: users[0],
    },
  });
  for (const [amount, inventoryCost, date] of [
    ["5.00", "7.1234", from],
    ["8.00", "7.1234", to],
    ["100.00", "1.0000", new Date(to.getTime() + 1)],
  ] as const)
    await db.purchaseReturn.create({
      data: {
        supplierId: supplier.id,
        invoiceId: invoice.id,
        reason: "test",
        total: amount,
        createdBy: users[0],
        createdAt: date,
        items: {
          create: {
            receiptItemId: receipt.items[0].id,
            quantity: 1,
            amount,
            inventoryCost,
          },
        },
      },
    });
}, 120000);
afterAll(async () => {
  await db?.$disconnect();
  await pg?.stop();
}, 120000);

describe("database dashboard financial equivalence", () => {
  for (let mask = 0; mask < 8; mask++)
    it(`matches all fields for permission mask ${mask}`, async () => {
      await compare([
        ...(mask & 1 ? ["sales.view_all"] : []),
        ...(mask & 2 ? ["reports.profit"] : []),
        ...(mask & 4 ? ["inventory.view"] : []),
      ]);
    });
  it("matches empty periods and a seller with no sales", async () => {
    await compare(
      ["sales.view_all", "reports.profit", "inventory.view"],
      new Date("2025-01-01"),
      new Date("2025-01-02"),
    );
    await compare([], from, to, randomUUID());
  });
  it.each([
    "2026-04-23T22:00:00Z",
    "2026-07-14T21:00:00Z",
    "2026-10-29T21:00:00Z",
    from.toISOString(),
    to.toISOString(),
  ])("matches exact inclusive instant %s", async (iso) => {
    await compare(
      ["sales.view_all", "reports.profit"],
      new Date(iso),
      new Date(iso),
    );
  });
  it("keeps daily grouping independent of the database session timezone", async () => {
    for (const zone of ["UTC", "America/New_York", "Africa/Cairo"]) {
      await compare(["sales.view_all"], from, to, users[0], zone);
    }
  });
  it("compares 20,000 additional sales and records actual timing and heap", async () => {
    const count = 20000;
    await db.$executeRaw`
      INSERT INTO "Sale" (id,"userId","branchId","shiftId",subtotal,discount,tax,"netBeforeTax","taxRate",total,change,"createdAt")
      SELECT md5('benchmark-' || n)::uuid, ${users[0]}::uuid, ${branches[0]}::uuid, ${shifts[0]}::uuid,
        100, 2, 13.72, 98, 14, 111.72, 0, timestamp '2026-06-15 12:00:00'
      FROM generate_series(1, ${count}::int) n`;
    await db.$executeRaw`
      INSERT INTO "SaleItem" (id,"saleId","variantId",name,options,barcode,"unitPrice","unitCost",quantity,discount,tax,total)
      SELECT md5('benchmark-item-' || n)::uuid, md5('benchmark-' || n)::uuid, ${variantId}::uuid,
        'Benchmark', '{}', 'test', 50, 7.1234, 2, 2, 13.72, 111.72
      FROM generate_series(1, ${count}::int) n`;
    await db.$executeRaw`
      INSERT INTO "SalePayment" (id,"saleId",method,amount)
      SELECT md5('benchmark-payment-' || n)::uuid, md5('benchmark-' || n)::uuid,
        'CASH', 10 FROM generate_series(1, ${count}::int) n`;
    const actor = asActor([
      "sales.view_all",
      "reports.profit",
      "inventory.view",
    ]);
    const samples: any[] = [];
    // Fresh processes isolate native/Intl allocations and avoid shared-RSS bias.
    for (let run = 0; run < 3; run++) {
      for (const name of run % 2 ? ["new", "old"] : ["old", "new"]) {
        const sample = JSON.parse(
          execFileSync(
            process.execPath,
            [
              "--expose-gc",
              "--max-old-space-size=256",
              "--import",
              "tsx",
              "tests/fixtures/dashboard-benchmark.ts",
              name,
            ],
            {
              env: { ...process.env, DASHBOARD_ACTOR: JSON.stringify(actor) },
              encoding: "utf8",
              maxBuffer: 1024 * 1024,
            },
          ),
        );
        expect(sample.orders).toBe(20096);
        samples.push({ ...sample, run });
      }
    }
    await compare(actor.permissions);
    await mkdir("test-results", { recursive: true });
    await writeFile(
      "test-results/dashboard-benchmark.json",
      JSON.stringify(
        {
          sales: 20120,
          inPeriodSales: 20096,
          node: process.version,
          gcExposed: Boolean((globalThis as any).gc),
          samples,
        },
        null,
        2,
      ),
    );
    console.log("dashboard benchmark", JSON.stringify(samples));
  }, 120000);
});
