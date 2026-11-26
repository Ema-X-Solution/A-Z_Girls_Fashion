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
  pg = new EmbeddedPostgres({ databaseDir: await mkdtemp(resolve(".test-data/product-code-pg-")), user: "az_test", password, port, persistent: true, initdbFlags: ["--encoding=UTF8", "--locale=C"], postgresFlags: ["-h", "127.0.0.1"] });
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
describe.sequential("product supplier code", () => {
  it("saves, edits, clears, validates, filters, searches and prints the product code", async () => {
    const sup = await db.supplier.create({ data: { name: "Linked" } });
    const cat = await send("post", "/categories", { name: "Product code cases" });
    const mk = (nameAr: string, extra: any = {}) => send("post", "/products", { nameAr, categoryId: cat.body.data.id, variants: [{ price: "100", options: { المقاس: "M" } }], ...extra });
    const a = await mk("Code A", { supplierCode: "AB-1234", primarySupplierId: sup.id });
    const b = await mk("Code B", { supplierCode: "xyz" });
    const c = await mk("Code C");
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
    expect(a.body.data.supplierCode).toBe("AB-1234"); expect(c.body.data.supplierCode).toBeNull();
    // filter (partial, case-insensitive) and free search
    const f = await agent.get("/api/products?supplierCode=ab-12&page=1&pageSize=25");
    expect(f.body.data.map((x: any) => x.id)).toEqual([a.body.data.id]);
    const s1 = await agent.get("/api/products?q=XYZ&page=1&pageSize=25");
    expect(s1.body.data.map((x: any) => x.id)).toEqual([b.body.data.id]);
    expect((await agent.get("/api/products?supplierCode=nope&page=1&pageSize=25")).body.total).toBe(0);
    // label returns both: the supplier's SUP code and the typed product code, separately
    const label = async (p: any) => (await send("post", "/barcodes/print-labels", { items: [{ variantId: p.body.data.variants[0].id, quantity: 1 }] })).body.data.items[0];
    expect(await label(a)).toMatchObject({ supplierCode: sup.code, productSupplierCode: "AB-1234" });
    expect(await label(b)).toMatchObject({ supplierCode: null, productSupplierCode: "xyz" });
    expect(await label(c)).toMatchObject({ supplierCode: null, productSupplierCode: null });
    await send("patch", `/products/${c.body.data.id}`, { primarySupplierId: sup.id });
    expect(await label(c)).toMatchObject({ supplierCode: sup.code, productSupplierCode: null });
    // edit then clear
    expect((await send("patch", `/products/${c.body.data.id}`, { supplierCode: " 77a " })).body.data.supplierCode).toBe("77a");
    expect((await send("patch", `/products/${c.body.data.id}`, { supplierCode: "" })).body.data.supplierCode).toBeNull();
    // validation
    for (const bad of ["bad<script>", "-lead", "x".repeat(51)]) expect((await send("patch", `/products/${c.body.data.id}`, { supplierCode: bad })).status).toBe(400);
    // patch without the field leaves it untouched
    await send("patch", `/products/${a.body.data.id}`, { nameAr: "Code A2" });
    expect((await agent.get(`/api/products/${a.body.data.id}`)).body.data.supplierCode).toBe("AB-1234");
  });
});
