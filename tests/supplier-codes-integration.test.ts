import { beforeAll, afterAll, describe, it, expect } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import request from "supertest";
let pg: EmbeddedPostgres, db: any, agent: any, csrf: string;
const origin = "http://localhost:5173", password = randomBytes(24).toString("hex");
beforeAll(async () => {
  const port = await new Promise<number>((done) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as any).port; s.close(() => done(p)); }); });
  await mkdir(".test-data", { recursive: true });
  pg = new EmbeddedPostgres({ databaseDir: await mkdtemp(resolve(".test-data/supplier-pg-")), user: "az_test", password, port, persistent: true, initdbFlags: ["--encoding=UTF8", "--locale=C"], postgresFlags: ["-h", "127.0.0.1"] });
  await pg.initialise(); await pg.start(); await pg.createDatabase("az_test");
  process.env.DATABASE_URL = `postgresql://az_test:${password}@127.0.0.1:${port}/az_test`;
  process.env.APP_ORIGIN = origin; process.env.NODE_ENV = "test";
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", "apps/api/prisma/schema.prisma"], { env: process.env, stdio: "pipe" });
  execFileSync(process.execPath, ["--import", "tsx", "apps/api/prisma/initialize.ts"], { env: { ...process.env, INITIAL_OWNER_EMAIL: "owner@example.test", INITIAL_OWNER_PASSWORD: password }, stdio: "pipe" });
  const app = (await import("../apps/api/src/app.js")).default;
  db = (await import("../apps/api/src/lib/db.js")).db;
  agent = request.agent(app);
  expect((await agent.post("/api/auth/login").set("Origin", origin).send({ email: "owner@example.test", password })).status).toBe(200);
  csrf = (await agent.get("/api/auth/me")).body.data.csrf;
}, 180000);
afterAll(async () => { await db?.$disconnect(); await pg?.stop(); }, 180000);
const send = (method: "post" | "patch", path: string, body: any) => agent[method](`/api${path}`).set("Origin", origin).set("X-CSRF-Token", csrf).send(body);
describe.sequential("auto supplier identity", () => {
  it("backfills two old suppliers deterministically without changing IDs or balances", async () => {
    // Replay only this migration in an isolated schema with a minimal legacy Supplier table.
    const migration = await readFile("apps/api/prisma/migrations/202611230020_supplier_codes/migration.sql", "utf8");
    const { Client } = await import("pg");
    const client = new Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
    try {
      await client.query('CREATE SCHEMA backfill_test; SET search_path TO backfill_test; CREATE TABLE "Supplier" ("id" UUID PRIMARY KEY, "createdAt" TIMESTAMP NOT NULL, "openingBalance" NUMERIC NOT NULL); INSERT INTO "Supplier" VALUES (\'11111111-1111-4111-8111-111111111111\', \'2020-01-01\', 125), (\'22222222-2222-4222-8222-222222222222\', \'2020-02-01\', 250)');
      await client.query('CREATE TABLE "Product" ("id" UUID PRIMARY KEY, "status" TEXT)');
      await client.query(migration);
      expect((await client.query('SELECT "id", "code", "openingBalance"::text AS balance FROM "Supplier" ORDER BY "createdAt"')).rows).toEqual([{ id: "11111111-1111-4111-8111-111111111111", code: "SUP-0001", balance: "125" }, { id: "22222222-2222-4222-8222-222222222222", code: "SUP-0002", balance: "250" }]);
      await client.query('INSERT INTO "Supplier" ("id", "createdAt", "openingBalance") VALUES (\'33333333-3333-4333-8333-333333333333\', now(), 0)');
      expect((await client.query('SELECT "code" FROM "Supplier" WHERE "id"=\'33333333-3333-4333-8333-333333333333\'')).rows[0].code).toBe("SUP-0003");
    } finally { await client.end(); }
  });
  it("generates unique codes, edits/searches code, rejects duplicates and leaves accounts intact", async () => {
    const a = await send("post", "/suppliers", { name: "First", openingBalance: "100" });
    const b = await send("post", "/suppliers", { name: "Second" });
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    expect(a.body.data.code).toMatch(/^SUP-\d{4,}$/); expect(b.body.data.code).not.toBe(a.body.data.code);
    const edited = await send("patch", `/suppliers/${a.body.data.id}`, { name: "First", code: "custom-01" }); expect(edited.status).toBe(200); expect(edited.body.data.code).toBe("CUSTOM-01");
    const found = await agent.get("/api/suppliers?q=CUSTOM-01"); expect(found.body.data.map((x: any) => x.id)).toContain(a.body.data.id);
    const duplicate = await send("patch", `/suppliers/${b.body.data.id}`, { name: "Second", code: "CUSTOM-01" }); expect(duplicate.status).toBe(409); expect(duplicate.body.error.code).toBe("SUPPLIER_CODE_EXISTS");
    for (const code of ["", "bad space", "x".repeat(41)]) expect((await send("patch", `/suppliers/${a.body.data.id}`, { name: "First", code })).status).toBe(400);
    const saved = await db.supplier.findUniqueOrThrow({ where: { id: a.body.data.id } }); expect(saved.openingBalance.toFixed(2)).toBe("100.00");
  });
  it("links/clears primary suppliers, filters products with pagination, and labels preserve actual barcode", async () => {
    const a = await db.supplier.create({ data: { name: "Primary A" } });
    const b = await db.supplier.create({ data: { name: "Primary B" } });
    const cat = await send("post", "/categories", { name: "Supplier linked products" });
    const create = (nameAr: string, primarySupplierId?: string, options = {}) => send("post", "/products", { nameAr, categoryId: cat.body.data.id, primarySupplierId, variants: [{ price: "100", options }] });
    const pa = await create("A product", a.id), pb = await create("B product", b.id), plain = await create("No supplier");
    expect(pa.status).toBe(201); expect(pb.status).toBe(201); expect(plain.status).toBe(201);
    const filtered = await agent.get(`/api/products?supplierId=${a.id}&page=1&pageSize=25`);
    expect(filtered.body.total).toBe(1); expect(filtered.body.data[0].id).toBe(pa.body.data.id);
    const print = await send("post", "/barcodes/print-labels", { items: [{ variantId: pa.body.data.variants[0].id, quantity: 2 }] });
    expect(print.body.data.items[0]).toMatchObject({ supplierCode: a.code, barcode: pa.body.data.variants[0].barcode, quantity: 2 });
    const noSupplier = await send("post", "/barcodes/print-labels", { items: [{ variantId: plain.body.data.variants[0].id, quantity: 1 }] });
    expect(noSupplier.body.data.items[0].supplierCode).toBeNull();
    expect((await send("patch", `/products/${plain.body.data.id}`, { primarySupplierId: b.id })).body.data.primarySupplierId).toBe(b.id);
    expect((await send("patch", `/products/${plain.body.data.id}`, { primarySupplierId: "" })).body.data.primarySupplierId).toBeNull();
    expect((await send("patch", `/products/${plain.body.data.id}`, { primarySupplierId: "bad" })).status).toBe(400);
    const missing = "99999999-9999-4999-8999-999999999999";
    expect((await send("patch", `/products/${plain.body.data.id}`, { primarySupplierId: missing })).status).toBe(400);
    const options = await agent.get(`/api/options/suppliers?q=${a.code}`); expect(options.body.data.some((v: any) => v.id === a.id)).toBe(true);
  });
  it("inherits the product supplier for every existing size/color variant at print time", async () => {
    const a = await db.supplier.create({ data: { name: "Variant supplier A" } });
    const b = await db.supplier.create({ data: { name: "Variant supplier B" } });
    const cat = await send("post", "/categories", { name: "Supplier variant cases" });
    const optionCases = [{}, { المقاس: "M" }, { اللون: "Red" }, { المقاس: "M", اللون: "Red" }];
    const created = await send("post", "/products", { nameAr: "Variant supplier inheritance", categoryId: cat.body.data.id, variants: optionCases.map((options) => ({ price: "100", options })) });
    expect(created.status).toBe(201);
    const product = created.body.data;
    const items = product.variants.map((v: any) => ({ variantId: v.id, quantity: 1 }));
    for (const supplier of [a, b, null]) {
      expect((await send("patch", `/products/${product.id}`, { primarySupplierId: supplier?.id ?? null })).status).toBe(200);
      const printed = await send("post", "/barcodes/print-labels", { items });
      expect(printed.status).toBe(200);
      expect(printed.body.data.items).toHaveLength(4);
      for (const line of printed.body.data.items) {
        const variant = product.variants.find((v: any) => v.id === line.variantId);
        expect(line.supplierCode).toBe(supplier?.code ?? null);
        expect(line.options).toEqual(variant.options);
        expect(line.barcode).toBe(variant.barcode);
      }
    }
  });
  it("handles parallel creates and skips a manually assigned future generated code", async () => {
    const next = await db.$queryRawUnsafe('SELECT last_value + 1 AS n FROM "Supplier_code_seq"');
    const reservedCode = `SUP-${String(next[0].n).padStart(4, "0")}`;
    const supplier = await db.supplier.create({ data: { name: "Reserve", code: reservedCode } });
    const rows = await Promise.all(Array.from({ length: 12 }, (_, i) => db.supplier.create({ data: { name: `Concurrent ${i}` } })));
    expect(new Set(rows.map((x) => x.code)).size).toBe(12); expect(rows.every((x) => x.code !== supplier.code)).toBe(true);
  });
});
