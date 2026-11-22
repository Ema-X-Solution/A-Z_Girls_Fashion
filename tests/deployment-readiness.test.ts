import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const run = promisify(execFile);
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))),
  );
});
async function fixture(
  reply: (path: string, count: number) => { status: number; body: unknown },
) {
  let requests = 0;
  const server = createServer((req, res) => {
    const result = reply(req.url ?? "", ++requests);
    res.writeHead(result.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result.body));
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    count: () => requests,
  };
}
const healthy = (path: string) => ({
  status: 200,
  body: path.endsWith("health")
    ? { status: "ok" }
    : { data: { logoUrl: "/test.png" } },
});
const args = (origin: string, extra: string[] = []) => [
  resolve("scripts/verify-deployment.mjs"),
  "--origin",
  origin,
  "--public-origin",
  origin,
  "--attempts",
  "3",
  "--interval-ms",
  "1",
  "--timeout-ms",
  "1000",
  ...extra,
];
describe("bounded deployment HTTP readiness", () => {
  it("waits through startup errors and checks both local and proxy endpoints", async () => {
    const site = await fixture((path, count) =>
      count <= 2 ? { status: 503, body: { error: "warming" } } : healthy(path),
    );
    const { stdout } = await run(process.execPath, args(site.origin));
    expect(stdout).toContain("readiness 2/3");
    expect(stdout).toContain("Public proxy");
    expect(stdout).toContain("readiness passed");
    expect(site.count()).toBe(6);
  });
  it("fails immediately on a public 502 without exposing response or process secrets", async () => {
    const local = await fixture(healthy);
    const proxy = await fixture(() => ({
      status: 502,
      body: { error: "PRIVATE_RESPONSE_MARKER" },
    }));
    const dir = await mkdtemp(join(tmpdir(), "az-pm2-test-"));
    try {
      await writeFile(
        join(dir, "pm2"),
        '#!/bin/sh\nprintf \'%s\' \'[{"name":"az-fashion-api","pm2_env":{"status":"errored","restart_time":2,"SECRET":"PRIVATE_PROCESS_MARKER"},"monit":{"memory":1024}},{"name":"unrelated-private-process"}]\'\n',
      );
      await chmod(join(dir, "pm2"), 0o700);
      const result = await run(
        process.execPath,
        args(local.origin, ["--public-origin", proxy.origin]),
        { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` } },
      ).then(
        () => null,
        (error) => error,
      );
      expect(result.code).toBe(1);
      expect(proxy.count()).toBe(2);
      const text = result.stdout + result.stderr;
      expect(text).toContain("502");
      expect(text).toContain('"status":"errored"');
      expect(text).not.toMatch(/PRIVATE_|unrelated-private-process|SECRET/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("rejects HTTP 200 responses with the wrong health payload and remains bounded", async () => {
    const site = await fixture(() => ({
      status: 200,
      body: { status: "broken" },
    }));
    const result = await run(
      process.execPath,
      args(site.origin, ["--attempts", "2"]),
    ).then(
      () => null,
      (error) => error,
    );
    expect(result.code).toBe(1);
    expect(site.count()).toBe(4);
    expect(result.stdout).toContain("not ready");
  });
});
