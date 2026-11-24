import { beforeAll, afterAll, describe, it, expect } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { mkdtemp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import request from "supertest";

let pg: EmbeddedPostgres, db: any, agent: any;
const origin = "http://localhost:5173",
  password = randomBytes(24).toString("hex");
const names = (res: any) =>
  (res.body.data as any[]).map((p) => p.nameAr).sort();

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
    databaseDir: await mkdtemp(resolve(".test-data/stock-filter-pg-")),
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
    ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "apps/api/prisma/schema.prisma"],
    { env: process.env, stdio: "pipe" },
  );
  execFileSync(process.execPath, ["--import", "tsx", "apps/api/prisma/initialize.ts"], {
    env: { ...process.env, INITIAL_OWNER_EMAIL: "owner@example.test", INITIAL_OWNER_PASSWORD: password },
    stdio: "pipe",
  });
  const app = (await import("../apps/api/src/app.js")).default;
  db = (await import("../apps/api/src/lib/db.js")).db;
  agent = request.agent(app);
  expect(
    (await agent.post("/api/auth/login").set("Origin", origin).send({ email: "owner@example.test", password })).status,
  ).toBe(200);

  const owner = await db.user.findFirst();
  const location = await db.stockLocation.findFirst();
  const location2 = await db.stockLocation.create({
    data: { branchId: location.branchId, name: "مخزن ثانٍ" },
  });
  (globalThis as any).__loc1 = location.id;
  (globalThis as any).__loc2 = location2.id;
  const category = await db.category.create({ data: { name: "تصنيف الاختبار" } });
  const s1 = await db.supplier.create({ data: { name: "مورد أول" } });
  const s2 = await db.supplier.create({ data: { name: "مورد ثاني" } });

  let seq = 0;
  const makeProduct = async (
    nameAr: string,
    supplierId: string | null,
    variants: { qty: number | null; minStock?: number; loc?: string }[],
  ) => {
    seq += 1;
    const product = await db.product.create({
      data: {
        nameAr,
        sku: `PRD-TEST-${seq}`,
        categoryId: category.id,
        createdBy: owner.id,
        primarySupplierId: supplierId,
        variants: {
          create: variants.map((v, i) => ({
            sku: `VAR-TEST-${seq}-${i}`,
            barcode: `9990000${seq}${i}`.padEnd(12, "0"),
            price: "100",
            minStock: v.minStock ?? 2,
          })),
        },
      },
      include: { variants: true },
    });
    for (const [i, v] of variants.entries()) {
      if (v.qty === null) continue; // no balance rows: never stocked
      await db.stockBalance.create({
        data: { variantId: product.variants[i].id, locationId: v.loc ?? location.id, quantity: v.qty },
      });
    }
    return product;
  };

  await makeProduct("أ-متوفر", s1.id, [{ qty: 10 }]);
  await makeProduct("ب-منخفض", s1.id, [{ qty: 2 }]); // qty == minStock
  await makeProduct("ج-منتهي", null, [{ qty: 0 }]);
  await makeProduct("د-منخفض-متغير-فارغ", null, [{ qty: 0 }, { qty: 8 }]);
  await makeProduct("ه-منتهي-بلا-أرصدة", null, [{ qty: null }]);
  await makeProduct("و-متوفر-مورد-ثاني", s2.id, [{ qty: 10 }]);
  await makeProduct("ز-مخزن-ثان-فقط", null, [{ qty: 5, loc: location2.id }]);
  await makeProduct("ح-صفر-مخزن-ثان", null, [{ qty: 0, loc: location2.id }]);
  (globalThis as any).__s2 = s2.id;
}, 180000);

afterAll(async () => {
  await db?.$disconnect();
  await pg?.stop();
}, 180000);

const list = (params: string) => agent.get(`/api/products?page=1&pageSize=100${params}`);

describe.sequential("products list stock and supplier filters", () => {
  it("stock=in returns only products above minStock somewhere", async () => {
    const res = await list("&stock=in");
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(["أ-متوفر", "ز-مخزن-ثان-فقط", "و-متوفر-مورد-ثاني"]);
  });
  it("stock=low returns products with a variant at or below minStock but not empty", async () => {
    const res = await list("&stock=low");
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(["ب-منخفض", "د-منخفض-متغير-فارغ"]);
  });
  it("stock=out returns products with zero on hand, including never-stocked", async () => {
    const res = await list("&stock=out");
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(["ج-منتهي", "ح-صفر-مخزن-ثان", "ه-منتهي-بلا-أرصدة"]);
  });
  it("supplierId narrows the list to that supplier", async () => {
    const s1 = await db.supplier.findFirst({ where: { name: "مورد أول" } });
    const res = await list(`&supplierId=${s1.id}`);
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(["أ-متوفر", "ب-منخفض"]);
  });
  it("supplier and stock filters combine", async () => {
    const s2 = (globalThis as any).__s2;
    const res = await list(`&supplierId=${s2}&stock=in`);
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(["و-متوفر-مورد-ثاني"]);
  });
  it("countOnly returns just the filtered total", async () => {
    const res = await agent.get("/api/products?countOnly=1&stock=out");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ total: 3 });
  });
  it("locationId keeps products with a stock row in that warehouse, zeros included", async () => {
    const loc2 = (globalThis as any).__loc2;
    const res = await list(`&locationId=${loc2}`);
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(["ح-صفر-مخزن-ثان", "ز-مخزن-ثان-فقط"]);
  });
  it("locationId excludes products with no stock row in that warehouse", async () => {
    const loc1 = (globalThis as any).__loc1;
    const res = await list(`&locationId=${loc1}`);
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(["أ-متوفر", "ب-منخفض", "ج-منتهي", "د-منخفض-متغير-فارغ", "و-متوفر-مورد-ثاني"]);
  });
  it("warehouse and stock filters combine", async () => {
    const loc1 = (globalThis as any).__loc1;
    const res = await list(`&locationId=${loc1}&stock=out`);
    expect(res.status).toBe(200);
    expect(names(res)).toEqual(["ج-منتهي"]);
  });
  it("without filters every product is listed", async () => {
    const res = await list("");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(8);
  });
});
