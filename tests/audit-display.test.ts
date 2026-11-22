import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { db } from "../apps/api/src/lib/db";
import { handleGetAuditLogs } from "../apps/api/src/controllers/audit.controller";
import { handlePostPromotions } from "../apps/api/src/controllers/promotions.controller";
afterEach(() => vi.restoreAllMocks());
describe("audit display data", () => {
  it("looks up actor names once per page without leaking user details", async () => {
    const rows = [
      { id: "a", userId: "owner" },
      { id: "b", userId: "owner" },
      { id: "c", userId: "deleted" },
      { id: "d", userId: null },
    ];
    vi.spyOn(db.auditLog, "findMany").mockResolvedValue(rows as never);
    const users = vi
      .spyOn(db.user, "findMany")
      .mockResolvedValue([{ id: "owner", name: "مدير تجريبي" }] as never);
    const result = await new Promise<any>((resolve, reject) => {
      handleGetAuditLogs(
        { query: { limit: "10", offset: "20" } } as unknown as Request,
        { json: resolve } as Response,
        reject,
      );
    });
    expect(db.auditLog.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: 10,
      skip: 20,
    });
    expect(users).toHaveBeenCalledOnce();
    expect(users).toHaveBeenCalledWith({
      where: { id: { in: ["owner", "deleted"] } },
      select: { id: true, name: true },
    });
    expect(result.data.map((r: any) => r.userName)).toEqual([
      "مدير تجريبي",
      "مدير تجريبي",
      null,
      null,
    ]);
    expect(result.data.map((r: any) => r.userId)).toEqual([
      "owner",
      "owner",
      "deleted",
      null,
    ]);
  });
  it("skips user queries for system-only pages", async () => {
    vi.spyOn(db.auditLog, "findMany").mockResolvedValue([
      { id: "system", userId: null },
    ] as never);
    const users = vi.spyOn(db.user, "findMany");
    await new Promise<void>((resolve, reject) => {
      handleGetAuditLogs(
        { query: {} } as Request,
        { json: () => resolve() } as unknown as Response,
        reject,
      );
    });
    expect(users).not.toHaveBeenCalled();
  });
});
describe("Arabic promotion validation", () => {
  it("rejects reversed dates with an Arabic field error before accessing the database", async () => {
    const next = vi.fn();
    await handlePostPromotions(
      {
        method: "POST",
        body: {
          name: "TEST promotion",
          type: "PERCENT",
          percent: "10",
          startsAt: "2026-11-02T00:00:00Z",
          endsAt: "2026-11-01T00:00:00Z",
        },
      } as Request,
      {} as Response,
      next,
    );
    expect(next.mock.calls[0][0].flatten().fieldErrors.endsAt).toEqual([
      "تاريخ نهاية العرض يجب أن يكون بعد تاريخ البداية.",
    ]);
  });
});
