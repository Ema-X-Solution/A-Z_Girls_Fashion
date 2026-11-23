import { beforeAll, afterAll, describe, it, expect } from "vitest";
import EmbeddedPostgres from "embedded-postgres";
import { chromium, type Browser } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Server } from "node:http";
import type { PrismaClient } from "@prisma/client";
let pg: EmbeddedPostgres,
  db: PrismaClient,
  browser: Browser,
  web: ViteDevServer,
  api: Server;
const password = randomBytes(24).toString("hex");

beforeAll(async () => {
  await mkdir(".test-data", { recursive: true });
  const { createServer: createSocketServer } = await import("node:net");
  const port = await new Promise<number>((done) => {
    const server = createSocketServer();
    server.listen(0, "127.0.0.1", () => {
      const n = (server.address() as { port: number }).port;
      server.close(() => done(n));
    });
  });
  pg = new EmbeddedPostgres({
    databaseDir: await mkdtemp(resolve(".test-data/pagination-")),
    user: "az_test",
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
  await pg.createDatabase("az_search");
  process.env.DATABASE_URL = `postgresql://az_test:${password}@127.0.0.1:${port}/az_search`;
  process.env.APP_ORIGIN = "http://127.0.0.1:5173";
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
  const { PrismaClient: Client } = await import("@prisma/client");
  db = new Client();
  const { hash } = await import("argon2");
  const { permissions } = await import("@az/shared");
  await db.permission.createMany({
    data: permissions.map((key) => ({ key })),
    skipDuplicates: true,
  });
  const role = await db.role.create({
    data: {
      name: "OWNER",
      permissions: {
        create: permissions.map((permissionKey) => ({ permissionKey })),
      },
    },
  });
  const user = await db.user.create({
    data: {
      name: "اختبار محلي",
      email: "local@example.test",
      passwordHash: await hash(password),
      roles: { create: { roleId: role.id } },
    },
  });
  const branch = await db.branch.create({ data: { name: "Benchmark" } });
  const location = await db.stockLocation.create({
    data: { name: "Benchmark", branchId: branch.id },
  });
  const category = await db.category.create({ data: { name: "Benchmark" } });
  const { randomUUID } = await import("node:crypto");
  for (let batch = 0; batch < 20; batch++) {
    const products = Array.from({ length: 1000 }, (_, i) => ({
      id: randomUUID(),
      nameAr: `Benchmark ${batch * 1000 + i}`,
      sku: `PERF-${batch * 1000 + i}`,
      categoryId: category.id,
      createdBy: user.id,
    }));
    await db.product.createMany({ data: products });
    const variants = products.flatMap((p) =>
      [0, 1, 2].map((v) => ({
        id: randomUUID(),
        productId: p.id,
        sku: `${p.sku}-${v}`,
        barcode: `B-${p.sku}-${v}`,
        price: 200,
        cost: 100,
        options: { size: ["S", "M", "L"][v], color: "blue" },
      })),
    );
    await db.productVariant.createMany({ data: variants });
    await db.stockBalance.createMany({
      data: variants.map((v) => ({
        variantId: v.id,
        locationId: location.id,
        quantity: 10,
        averageCost: 100,
      })),
    });
  }
  await db.$executeRawUnsafe('ANALYZE "Product"');
  await db.$executeRawUnsafe('ANALYZE "ProductVariant"');
  await db.$executeRawUnsafe('ANALYZE "StockBalance"');
  const app = (await import("../apps/api/src/app")).default;
  api = app.listen(3001, "127.0.0.1");
  web = await createServer({
    root: resolve("apps/web"),
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
  });
  await web.listen();
  browser = await chromium.launch({
    ...(process.env.BROWSER_CHANNEL
      ? { channel: process.env.BROWSER_CHANNEL }
      : { executablePath: "/usr/bin/google-chrome" }),
    headless: true,
  });
  await mkdir("test-results/pagination", { recursive: true });
}, 120000);
afterAll(async () => {
  await browser?.close();
  await web?.close();
  if (api) await new Promise<void>((done) => api.close(() => done()));
  await db?.$disconnect();
  await pg?.stop();
}, 120000);
describe("synthetic product pagination benchmark", () => {
  it("measures HTTP latency against 20k products, 60k variants and 60k balances", async () => {
    const context = await browser.newContext();
    await context.request.post("http://127.0.0.1:3001/api/auth/login", {
      headers: { Origin: "http://127.0.0.1:5173" },
      data: { email: "local@example.test", password },
    });
    const results = [];
    const cases = [
      ...[25, 50, 100, 150].flatMap((size) => [
        { name: `new-${size}-first`, query: `page=1&pageSize=${size}` },
        {
          name: `new-${size}-deep`,
          query: `page=${Math.floor(19000 / size) + 1}&pageSize=${size}`,
        },
      ]),
      { name: "legacy-30-first", query: "limit=30&offset=0" },
      { name: "legacy-100-first", query: "limit=100&offset=0" },
      { name: "legacy-100-deep", query: "limit=100&offset=19000" },
      { name: "search-name", query: "page=1&pageSize=25&q=Benchmark%2019999" },
      { name: "search-absent", query: "page=1&pageSize=25&q=NOTFOUND" },
    ];
    for (const c of cases) {
      const times = [];
      let bytes = 0;
      let rows = 0;
      for (let n = 0; n < 17; n++) {
        const start = performance.now();
        const r = await context.request.get(
          `http://127.0.0.1:3001/api/products?${c.query}`,
        );
        const body = await r.body();
        expect(r.status()).toBe(200);
        const data = JSON.parse(body.toString());
        rows = data.data.length;
        bytes = body.length;
        if (n >= 2) times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      results.push({
        case: c.name,
        rows,
        bytes,
        medianMs: +times[7].toFixed(2),
        p95Ms: +times[14].toFixed(2),
      });
    }
    const concurrentStart = performance.now();
    const concurrent = await Promise.all(
      Array.from({ length: 10 }, () =>
        context.request.get(
          "http://127.0.0.1:3001/api/products?page=1&pageSize=150",
        ),
      ),
    );
    expect(concurrent.every((r) => r.status() === 200)).toBe(true);
    const report = {
      products: 20000,
      variants: 60000,
      balances: 60000,
      warmups: 2,
      samples: 15,
      results,
      tenConcurrent150WallMs: +(performance.now() - concurrentStart).toFixed(2),
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    };
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      "test-results/pagination/performance.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    await context.close();
  }, 120000);
});
