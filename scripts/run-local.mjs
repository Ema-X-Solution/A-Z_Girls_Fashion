import EmbeddedPostgres from "embedded-postgres";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { preview } from "vite";
import { URL } from "node:url";

const directory = resolve(".local");
mkdirSync(directory, { recursive: true });
const configFile = resolve(directory, "config.json");
const config = existsSync(configFile)
  ? JSON.parse(readFileSync(configFile, "utf8"))
  : {
      databasePassword: randomBytes(32).toString("hex"),
      ownerEmail: "owner@az.local",
      ownerPassword: randomBytes(18).toString("base64url"),
    };
writeFileSync(configFile, JSON.stringify(config, null, 2), { mode: 0o600 });
const availablePort = () =>
  new Promise((done, error) => {
    const server = createServer();
    server.once("error", error);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => done(port));
    });
  });
const databasePort = await availablePort(),
  databaseDir = resolve(directory, "postgres");
const logs = [];
const pg = new EmbeddedPostgres({
  databaseDir,
  user: "az_local",
  password: config.databasePassword,
  port: databasePort,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  postgresFlags: ["-h", "127.0.0.1"],
  onLog: (message) => logs.push(String(message)),
  onError: (message) => logs.push(String(message)),
});
let started = false,
  http,
  web,
  db;
pg.stop = async () => {
  if (!started) return;
  const binaries = await import(
    `@embedded-postgres/${process.platform === "win32" ? "windows" : process.platform}-${process.arch}`
  );
  execFileSync(
    binaries.pg_ctl,
    ["-D", databaseDir, "-m", "fast", "-w", "-t", "15", "stop"],
    { stdio: "pipe" },
  );
  started = false;
};
async function stop() {
  web?.httpServer.closeAllConnections();
  await new Promise((r) => (web ? web.httpServer.close(r) : r()));
  http?.closeAllConnections();
  await new Promise((r) => (http ? http.close(r) : r()));
  await db?.$disconnect();
  await pg.stop();
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void stop().finally(() => process.exit(0));
  });
try {
  if (!existsSync(resolve(databaseDir, "PG_VERSION"))) await pg.initialise();
  try {
    await pg.start();
    started = true;
  } catch {
    throw new Error(logs.slice(-8).join("\n"));
  }
  const client = pg.getPgClient("postgres", "127.0.0.1");
  await client.connect();
  const existing = await client.query(
    "SELECT 1 FROM pg_database WHERE datname='az_fashion'",
  );
  if (!existing.rowCount) await client.query("CREATE DATABASE az_fashion");
  await client.end();
  process.env.DATABASE_URL = `postgresql://az_local:${config.databasePassword}@127.0.0.1:${databasePort}/az_fashion`;
  process.env.NODE_ENV = "development";
  process.env.LOCAL_LOOPBACK_ALIASES = "true";
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
  if (
    !existsSync("apps/api/dist/server.js") ||
    !existsSync("apps/web/dist/index.html")
  )
    throw new Error("Run npm run build before starting the local application");
  db = (await import("../apps/api/dist/lib/db.js")).db;
  if ((await db.user.count()) === 0)
    execFileSync(
      process.execPath,
      ["--import", "tsx", "apps/api/prisma/initialize.ts"],
      {
        env: {
          ...process.env,
          INITIAL_OWNER_EMAIL: config.ownerEmail,
          INITIAL_OWNER_PASSWORD: config.ownerPassword,
        },
        stdio: "pipe",
      },
    );
  const app = (await import("../apps/api/dist/app.js")).default;
  http = app.listen(0, "127.0.0.1");
  await new Promise((r) => http.once("listening", r));
  const apiPort = http.address().port;
  web = await preview({
    root: resolve("apps/web"),
    preview: {
      host: "127.0.0.1",
      port:
        config.webPort ??
        (existsSync(resolve(directory, "access.txt"))
          ? Number(
              new URL(
                readFileSync(resolve(directory, "access.txt"), "utf8")
                  .split("\n")[0]
                  .slice(5),
              ).port,
            )
          : await availablePort()),
      strictPort: true,
      proxy: { "/api": `http://127.0.0.1:${apiPort}` },
    },
  });
  const url = `http://127.0.0.1:${web.httpServer.address().port}`;
  process.env.APP_ORIGIN = url;
  config.webPort = web.httpServer.address().port;
  writeFileSync(configFile, JSON.stringify(config, null, 2), { mode: 0o600 });
  writeFileSync(
    resolve(directory, "runtime.json"),
    JSON.stringify({ pid: process.pid, url, databasePort }),
    { mode: 0o600 },
  );
  const health = await globalThis.fetch(`${url}/api/health`);
  if (!health.ok) throw new Error("API health check failed");
  const access = `URL: ${url}\nEmail: ${config.ownerEmail}\nPassword: ${config.ownerPassword}\n`;
  writeFileSync(resolve(directory, "access.txt"), access, { mode: 0o600 });
  console.log(`\nLOCAL APPLICATION READY\n${access}`);
} catch (error) {
  console.error(error.message);
  await stop();
  process.exit(1);
}
