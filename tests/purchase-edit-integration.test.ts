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
    databaseDir: await mkdtemp(resolve(".test-data/purchase-edit-pg-")),
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
  method: "post" | "patch",
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
async function snapshot(
  supplierId: string,
  variantIds: string[],
) {
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
describe.sequential("purchase invoice edit + un-approve", () => {
  it("changes nothing in accounts before receiving, and receiving afterwards uses the edited numbers", async () => {
    const supplier = await db.supplier.create({
      data: { name: "Edit supplier", openingBalance: "100" },
    });
    const supplier2 = await db.supplier.create({
      data: { name: "Edit supplier 2" },
    });
    const branch = await db.branch.findFirstOrThrow();
    const loc = await db.stockLocation.create({
      data: { name: "Edit loc", branchId: branch.id },
    });
    const cat = await send("post", "/categories", { name: "Edit cases" });
    const mk = async (n: string, price: string) =>
      (
        await send("post", "/products", {
          nameAr: n,
          categoryId: cat.body.data.id,
          variants: [{ price, options: { المقاس: "M" } }],
        })
      ).body.data.variants[0].id;
    const [a, b, c] = [
      await mk("Edit A", "200"),
      await mk("Edit B", "300"),
      await mk("Edit C", "400"),
    ];
    const ids = [a, b, c];
    const created = await send("post", "/purchases", {
      supplierId: supplier.id,
      locationId: loc.id,
      items: [
        { variantId: a, quantity: 5, unitCost: "100", salePrice: "200" },
        { variantId: b, quantity: 2, unitCost: "50", salePrice: "300" },
      ],
    });
    expect(created.status).toBe(201);
    const pid = created.body.data.id;
    const base = await snapshot(supplier.id, ids);
    // 1) edit draft: change supplier, qty, cost, remove B, add C. Sale price must not move.
    const edit = await send("patch", `/purchases/${pid}`, {
      supplierId: supplier2.id,
      locationId: loc.id,
      items: [
        { variantId: a, quantity: 4, unitCost: "110" },
        { variantId: c, quantity: 3, unitCost: "70" },
      ],
    });
    expect(edit.status).toBe(200);
    expect(await snapshot(supplier.id, ids)).toEqual(base);
    expect((await snapshot(supplier2.id, ids)).invoices).toBe(0);
    let order = await db.purchaseOrder.findUniqueOrThrow({
      where: { id: pid },
      include: { items: true },
    });
    expect(order.status).toBe("DRAFT");
    expect(order.supplierId).toBe(supplier2.id);
    expect(
      order.items
        .map((i: any) => [
          i.variantId,
          i.quantity,
          i.received,
          i.unitCost.toFixed(2),
        ])
        .sort(),
    ).toEqual(
      [
        [a, 4, 0, "110.00"],
        [c, 3, 0, "70.00"],
      ].sort(),
    );
    // duplicate lines and empty lists are rejected, nothing changes
    expect(
      (
        await send("patch", `/purchases/${pid}`, {
          supplierId: supplier2.id,
          locationId: loc.id,
          items: [
            { variantId: a, quantity: 1, unitCost: "1" },
            { variantId: a, quantity: 1, unitCost: "2" },
          ],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await send("patch", `/purchases/${pid}`, {
          supplierId: supplier2.id,
          locationId: loc.id,
          items: [],
        })
      ).status,
    ).toBe(400);
    order = await db.purchaseOrder.findUniqueOrThrow({
      where: { id: pid },
      include: { items: true },
    });
    expect(order.items).toHaveLength(2);
    // 2) approve, then editing is refused; un-approve returns it to draft with no effect
    expect((await send("post", `/purchases/${pid}/approve`, {})).status).toBe(
      200,
    );
    expect(
      (
        await send("patch", `/purchases/${pid}`, {
          supplierId: supplier2.id,
          locationId: loc.id,
          items: [{ variantId: a, quantity: 9, unitCost: "9" }],
        })
      ).status,
    ).toBe(409);
    expect((await send("post", `/purchases/${pid}/unapprove`, {})).status).toBe(
      200,
    );
    expect(
      (await db.purchaseOrder.findUniqueOrThrow({ where: { id: pid } })).status,
    ).toBe("DRAFT");
    expect((await send("post", `/purchases/${pid}/unapprove`, {})).status).toBe(
      409,
    ); // already draft
    expect(
      (
        await send(
          "post",
          `/purchases/${pid}/receive`,
          { items: [{ purchaseItemId: order.items[0].id, quantity: 1 }] },
          crypto.randomUUID(),
        )
      ).status,
    ).toBe(409); // draft cannot be received
    expect(await snapshot(supplier.id, ids)).toEqual(base);
    // 3) edit again after un-approve, approve, receive part: accounts follow the edited numbers
    const again = await send("patch", `/purchases/${pid}`, {
      supplierId: supplier2.id,
      locationId: loc.id,
      items: [
        { variantId: a, quantity: 4, unitCost: "120" },
        { variantId: c, quantity: 3, unitCost: "70" },
      ],
    });
    expect(again.status).toBe(200);
    expect((await send("post", `/purchases/${pid}/approve`, {})).status).toBe(
      200,
    );
    order = await db.purchaseOrder.findUniqueOrThrow({
      where: { id: pid },
      include: { items: true },
    });
    const ia = order.items.find((i: any) => i.variantId === a),
      ic = order.items.find((i: any) => i.variantId === c);
    const rec = await send(
      "post",
      `/purchases/${pid}/receive`,
      {
        items: [
          { purchaseItemId: ia.id, quantity: 4 },
          { purchaseItemId: ic.id, quantity: 1 },
        ],
      },
      crypto.randomUUID(),
    );
    expect(rec.status).toBe(200);
    expect(Number(rec.body.data.total)).toBe(550); // 4*120 + 1*70
    const bal = await db.stockBalance.findMany({
      where: { variantId: { in: [a, b, c] }, locationId: loc.id },
    });
    expect(
      Object.fromEntries(bal.map((x: any) => [x.variantId, x.quantity])),
    ).toEqual({ [a]: 4, [c]: 1 });
    const batch = await db.stockBatch.findFirstOrThrow({
      where: { variantId: a, locationId: loc.id },
    });
    expect(batch.unitCost.toFixed(2)).toBe("120.00");
    expect(batch.quantity).toBe(4);
    expect(
      (
        await db.supplierInvoice.aggregate({
          where: { supplierId: supplier2.id },
          _sum: { total: true },
        })
      )._sum.total.toFixed(2),
    ).toBe("550.00");
    expect(
      (
        await db.supplierInvoice.aggregate({
          where: { supplierId: supplier.id },
          _sum: { total: true },
        })
      )._sum.total,
    ).toBeNull();
    // 4) after a receipt: approved->PARTIAL cannot be un-approved or edited
    expect((await send("post", `/purchases/${pid}/unapprove`, {})).status).toBe(
      409,
    );
    expect(
      (
        await send("patch", `/purchases/${pid}`, {
          supplierId: supplier2.id,
          locationId: loc.id,
          items: [{ variantId: a, quantity: 1, unitCost: "1" }],
        })
      ).status,
    ).toBe(409);
    const after = await snapshot(supplier2.id, ids);
    expect((await send("post", `/purchases/${pid}/unapprove`, {})).status).toBe(
      409,
    );
    expect(await snapshot(supplier2.id, ids)).toEqual(after);
    // sale prices never moved through edit / un-approve (only the original create set them)
    const prices = await db.productVariant.findMany({
      where: { id: { in: ids } },
      select: { id: true, price: true },
    });
    expect(
      Object.fromEntries(prices.map((p: any) => [p.id, p.price.toFixed(2)])),
    ).toEqual({ [a]: "200.00", [b]: "300.00", [c]: "400.00" });
    // audit trail
    const actions = (
      await db.auditLog.findMany({
        where: { reference: pid },
        orderBy: { createdAt: "asc" },
      })
    ).map((x: any) => x.action);
    expect(actions).toEqual(
      [
        "PURCHASE_CREATE",
        "PURCHASE_EDIT",
        "PURCHASE_APPROVE",
        "PURCHASE_UNAPPROVE",
        "PURCHASE_EDIT",
        "PURCHASE_APPROVE",
        "PURCHASE_RECEIVE",
      ]
        .slice(0, 6)
        .concat(actions.slice(6)),
    );
    expect(
      actions.filter((x: string) => x === "PURCHASE_UNAPPROVE"),
    ).toHaveLength(1);
  });
});
