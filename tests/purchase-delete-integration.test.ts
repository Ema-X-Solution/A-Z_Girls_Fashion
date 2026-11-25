import { beforeAll, afterAll, describe, it, expect } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { mkdtemp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import request from "supertest";
let pg: EmbeddedPostgres, db: any, agent: any, csrf: string;
const origin = "http://localhost:5173",
  password = randomBytes(24).toString("hex");
beforeAll(async () => {
  const port = await new Promise<number>((done) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as any).port;
      s.close(() => done(p));
    });
  });
  await mkdir(".test-data", { recursive: true });
  pg = new EmbeddedPostgres({
    databaseDir: await mkdtemp(resolve(".test-data/purchase-delete-pg-")),
    user: "az_test",
    password,
    port,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-h", "127.0.0.1"],
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("az_test");
  process.env.DATABASE_URL = `postgresql://az_test:${password}@127.0.0.1:${port}/az_test`;
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
  const app = (await import("../apps/api/src/app.js")).default;
  db = (await import("../apps/api/src/lib/db.js")).db;
  agent = request.agent(app);
  expect(
    (
      await agent
        .post("/api/auth/login")
        .set("Origin", origin)
        .send({ email: "owner@example.test", password })
    ).status,
  ).toBe(200);
  csrf = (await agent.get("/api/auth/me")).body.data.csrf;
}, 180000);
afterAll(async () => {
  await db?.$disconnect();
  await pg?.stop();
}, 180000);
const send = (
  method: "post" | "patch" | "delete",
  path: string,
  body: any,
  key?: string,
) => {
  const r = agent[method](`/api${path}`)
    .set("Origin", origin)
    .set("X-CSRF-Token", csrf);
  if (key) r.set("Idempotency-Key", key);
  return r.send(body);
};
// Everything that could carry accounting effect, as plain comparable data.
async function snapshot(supplierId: string, variantIds: string[]) {
  const inv = await db.supplierInvoice.aggregate({
    where: { supplierId },
    _sum: { total: true },
    _count: true,
  });
  const supplier = await db.supplier.findUniqueOrThrow({
    where: { id: supplierId },
  });
  const variants = await db.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, price: true, minStock: true },
    orderBy: { id: "asc" },
  });
  return {
    invoices: inv._count,
    invoiced: String(inv._sum.total ?? 0),
    opening: supplier.openingBalance.toFixed(2),
    receipts: await db.purchaseReceipt.count(),
    balances: await db.stockBalance.count({
      where: { variantId: { in: variantIds } },
    }),
    qty: (
      await db.stockBalance.findMany({
        where: { variantId: { in: variantIds } },
        orderBy: { variantId: "asc" },
      })
    ).map((b: any) => [b.quantity, b.averageCost.toFixed(4)]),
    movements: await db.stockMovement.count({
      where: { variantId: { in: variantIds } },
    }),
    batches: await db.stockBatch.count({
      where: { variantId: { in: variantIds } },
    }),
    flows: await db.stockCostFlow.count({
      where: { variantId: { in: variantIds } },
    }),
    prices: variants.map((v: any) => [v.price.toFixed(2), v.minStock]),
    purchaseReturns: await db.purchaseReturn.count(),
    payments: await db.supplierPayment.count(),
  };
}
describe.sequential("delete a draft purchase invoice", () => {
  it("removes only a draft, with zero accounting effect", async () => {
    const supplier = await db.supplier.create({
      data: { name: "Del supplier", openingBalance: "100" },
    });
    const branch = await db.branch.findFirstOrThrow();
    const loc = await db.stockLocation.create({
      data: { name: "Del loc", branchId: branch.id },
    });
    const cat = await send("post", "/categories", { name: "Del cases" });
    const mk = async (n: string, price: string) =>
      (
        await send("post", "/products", {
          nameAr: n,
          categoryId: cat.body.data.id,
          variants: [{ price, options: { المقاس: "M" } }],
        })
      ).body.data.variants[0].id;
    const [a, b] = [await mk("Del A", "200"), await mk("Del B", "300")];
    const ids = [a, b];
    const mkOrder = async (items: any[]) =>
      (
        await send("post", "/purchases", {
          supplierId: supplier.id,
          locationId: loc.id,
          items,
        })
      ).body.data.id as string;
    const line = (v: string, q: number, c: string, p: string) => ({
      variantId: v,
      quantity: q,
      unitCost: c,
      salePrice: p,
    });
    // A keeper order that must stay untouched by every delete below.
    const keep = await mkOrder([line(b, 2, "50", "300")]);
    const base = await snapshot(supplier.id, ids);
    const itemsBefore = await db.purchaseOrderItem.count();
    // 1) delete a draft
    const d1 = await mkOrder([
      line(a, 5, "100", "200"),
      line(b, 1, "40", "300"),
    ]);
    const afterCreate = await snapshot(supplier.id, ids);
    expect((await db.purchaseOrderItem.count()) - itemsBefore).toBe(2);
    const del1 = await send("delete", `/purchases/${d1}`, {});
    expect(del1.status).toBe(200);
    expect(await db.purchaseOrder.findUnique({ where: { id: d1 } })).toBeNull();
    expect(
      await db.purchaseOrderItem.count({ where: { purchaseId: d1 } }),
    ).toBe(0);
    expect(await db.purchaseOrderItem.count()).toBe(itemsBefore);
    expect(await snapshot(supplier.id, ids)).toEqual(afterCreate);
    expect(afterCreate).toEqual(base);
    expect(
      await db.purchaseOrder.findUnique({ where: { id: keep } }),
    ).not.toBeNull();
    // second delete of the same id: not found as a draft
    expect((await send("delete", `/purchases/${d1}`, {})).status).toBe(409);
    // bad id
    expect((await send("delete", `/purchases/not-a-uuid`, {})).status).toBe(
      400,
    );
    // 2) approved cannot be deleted; after un-approve it can
    const d2 = await mkOrder([line(a, 3, "10", "200")]);
    await send("post", `/purchases/${d2}/approve`, {});
    expect((await send("delete", `/purchases/${d2}`, {})).status).toBe(409);
    expect(
      await db.purchaseOrder.findUnique({ where: { id: d2 } }),
    ).not.toBeNull();
    await send("post", `/purchases/${d2}/unapprove`, {});
    expect((await send("delete", `/purchases/${d2}`, {})).status).toBe(200);
    // 3) received (partial) invoice cannot be deleted and nothing moves
    const d3 = await mkOrder([line(a, 4, "120", "200")]);
    await send("post", `/purchases/${d3}/approve`, {});
    const o3 = await db.purchaseOrder.findUniqueOrThrow({
      where: { id: d3 },
      include: { items: true },
    });
    const rec = await send(
      "post",
      `/purchases/${d3}/receive`,
      { items: [{ purchaseItemId: o3.items[0].id, quantity: 1 }] },
      crypto.randomUUID(),
    );
    expect(rec.status).toBe(200);
    const afterReceive = await snapshot(supplier.id, ids);
    expect((await send("delete", `/purchases/${d3}`, {})).status).toBe(409);
    expect(await snapshot(supplier.id, ids)).toEqual(afterReceive);
    expect(
      await db.purchaseOrder.findUnique({ where: { id: d3 } }),
    ).not.toBeNull();
    // 4) audit trail records the deletes
    const del = await db.auditLog.findMany({
      where: { action: "PURCHASE_DELETE" },
    });
    expect(del.map((x: any) => x.reference).sort()).toEqual([d1, d2].sort());
  });
});
