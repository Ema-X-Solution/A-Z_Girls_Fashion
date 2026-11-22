import { describe, expect, it } from "vitest";
import {
  cairoCalendarDay,
  dashboardInterval,
  defaultDashboardDays,
} from "../apps/web/src/features/dashboard/dashboard-period";

describe("dashboard Cairo calendar periods", () => {
  it("defaults to the current Cairo month through today", () => {
    const days = defaultDashboardDays(new Date("2026-11-22T17:00:00Z"));
    expect(days).toEqual({ from: "2026-11-01", to: "2026-11-22" });
    expect(dashboardInterval(days)).toEqual({
      from: "2026-10-31T22:00:00.000Z",
      to: "2026-11-22T21:59:59.999Z",
    });
  });
  it("uses Cairo's date at the year boundary, not the UTC date", () => {
    const now = new Date("2026-12-31T22:30:00Z");
    expect(cairoCalendarDay(now)).toBe("2027-01-01");
    expect(defaultDashboardDays(now)).toEqual({
      from: "2027-01-01",
      to: "2027-01-01",
    });
  });
  it.each([
    ["2026-04-24", "2026-04-23T22:00:00.000Z", "2026-04-24T20:59:59.999Z", 23],
    ["2026-10-29", "2026-10-28T21:00:00.000Z", "2026-10-29T21:59:59.999Z", 25],
  ])("keeps the whole seasonal-offset day %s", (day, from, to, hours) => {
    const interval = dashboardInterval({ from: day, to: day });
    expect(interval).toEqual({ from, to });
    expect(new Date(to).getTime() - new Date(from).getTime() + 1).toBe(
      hours * 3600000,
    );
  });
  it.each([
    { from: "", to: "2026-11-22" },
    { from: "2026-11-22", to: "" },
    { from: "2026-02-30", to: "2026-03-01" },
    { from: "2026-11-23", to: "2026-11-22" },
    { from: "2025-01-01", to: "2026-11-22" },
  ])(
    "rejects invalid or overlong input without constructing a query",
    (days) => {
      expect(dashboardInterval(days)).toBeNull();
    },
  );
});
