/* global fetch, URL, AbortSignal */
// Read-only readiness checks. Never print response bodies, environment or PM2 logs.
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const option = (key, fallback) => {
  const at = process.argv.lastIndexOf(key);
  return at < 0 ? fallback : process.argv[at + 1];
};
const attempts = Number(option("--attempts", "30"));
const interval = Number(option("--interval-ms", "2000"));
const timeout = Number(option("--timeout-ms", "5000"));
const local = option(
  "--origin",
  `http://127.0.0.1:${process.env.PORT ?? 3001}`,
);
const publicOrigin = option("--public-origin", "https://azs.business");
if (
  !Number.isInteger(attempts) ||
  attempts < 1 ||
  attempts > 30 ||
  !Number.isFinite(interval) ||
  interval < 0 ||
  interval > 5000 ||
  !Number.isFinite(timeout) ||
  timeout < 1 ||
  timeout > 5000
) {
  console.error("Invalid readiness bounds.");
  process.exit(1);
}
async function probe(origin, path) {
  try {
    const response = await fetch(new URL(path, origin), {
      signal: AbortSignal.timeout(timeout),
      redirect: "error",
      headers: { "Cache-Control": "no-cache" },
    });
    const body = response.ok ? await response.json() : null;
    const valid = path.endsWith("health")
      ? body?.status === "ok"
      : body?.data && typeof body.data === "object";
    return {
      path,
      status: response.status,
      ok: response.status === 200 && !!valid,
    };
  } catch {
    return { path, status: "unavailable", ok: false };
  }
}
async function ready(origin, label, failOn502 = false) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const results = await Promise.all(
      ["/api/health", "/api/branding"].map((path) => probe(origin, path)),
    );
    console.log(
      `${label} readiness ${attempt}/${attempts}: ${results.map((r) => `${r.path}=${r.status}${r.ok ? "" : " (not ready)"}`).join(", ")}`,
    );
    if (results.every((r) => r.ok)) return true;
    if (failOn502 && results.some((r) => r.status === 502)) return false;
    if (attempt < attempts) await delay(interval);
  }
  return false;
}
function diagnostics() {
  try {
    const processes = JSON.parse(
      execFileSync("pm2", ["jlist"], {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
    const api = processes
      .filter((p) => p.name === "az-fashion-api")
      .map((p) => ({
        name: p.name,
        status: p.pm2_env?.status,
        restarts: p.pm2_env?.restart_time,
        uptimeMs: p.pm2_env?.pm_uptime
          ? Date.now() - p.pm2_env.pm_uptime
          : null,
        memoryBytes: p.monit?.memory,
      }));
    console.error(`API process summary: ${JSON.stringify(api)}`);
  } catch {
    console.error("API process summary unavailable.");
  }
}
try {
  if (
    !(await ready(local, "Local API")) ||
    !(await ready(publicOrigin, "Public proxy", true))
  ) {
    console.error(
      "Deployment failed HTTP readiness. Review before declaring it healthy.",
    );
    diagnostics();
    process.exitCode = 1;
  } else console.log("Deployment HTTP readiness passed.");
} catch {
  console.error("Deployment readiness check failed.");
  diagnostics();
  process.exitCode = 1;
}
