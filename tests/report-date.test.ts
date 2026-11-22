import { describe, expect, it } from "vitest";
import { reportDate } from "../apps/api/src/utils/report-date";

describe("report header dates in Cairo", () => {
  it.each([
    ["2026-11-21T22:00:00.000Z", "2026-11-22"],
    ["2026-07-14T21:00:00.000Z", "2026-07-15"],
    ["2026-04-23T22:00:00.000Z", "2026-04-24"],
    ["2026-10-29T22:00:00.000Z", "2026-10-30"],
    ["2026-11-22T21:59:59.999Z", "2026-11-22"],
    ["2026-07-15T20:59:59.999Z", "2026-07-15"],
    ["2026-12-31T22:00:00.000Z", "2027-01-01"],
  ])("formats %s as %s without changing the instant", (iso, expected) => {
    const date = new Date(iso);
    expect(reportDate(date)).toBe(expected);
    expect(date.toISOString()).toBe(iso);
  });
});
