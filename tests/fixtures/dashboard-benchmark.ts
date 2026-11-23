// Separate process per implementation: native/Intl allocations from the legacy
// run must not inflate the SQL run's resident-memory measurement.
import { PrismaClient } from "@prisma/client";
import { dashboardData } from "../../apps/api/src/controllers/reports.controller.js";
import { legacyDashboardData } from "./dashboard-legacy.js";
async function main() {
  const db = new PrismaClient();
  const fn = process.argv[2] === "old" ? legacyDashboardData : dashboardData;
  const actor = JSON.parse(process.env.DASHBOARD_ACTOR!);
  try {
    await db.$connect();
    (globalThis as any).gc?.();
    const before = process.memoryUsage();
    const start = performance.now();
    const result = await fn(
      db,
      actor,
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-12-31T23:59:59.999Z"),
    );
    const after = process.memoryUsage();
    console.log(
      JSON.stringify({
        name: process.argv[2],
        ms: performance.now() - start,
        orders: result.orders,
        before,
        after,
        peakRssBytes: process.resourceUsage().maxRSS * 1024,
        heapDeltaBytes: after.heapUsed - before.heapUsed,
      }),
    );
  } finally {
    await db.$disconnect();
  }
}
void main();
