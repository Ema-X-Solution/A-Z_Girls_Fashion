import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { dashboardData } from "../apps/api/src/controllers/reports.controller.js";
import { D } from "../apps/api/src/utils/money.js";

describe("cashier VAT totals", () => {
  it("formats grouped sellers separately and keeps zero-invoice return-only sellers", async () => {
    const from = new Date("2026-11-01T00:00:00Z"),
      to = new Date("2026-11-30T23:59:59Z");
    const row = (
      id: string,
      invoices: number,
      net: number,
      gross: number,
      sales: number,
      refunds: number,
    ) => ({
      id,
      name: "Same name",
      sellerCode: id,
      invoices,
      netSales: D(net),
      grossSales: D(gross),
      salesWithTax: D(sales),
      returnsWithTax: D(refunds),
    });
    const tx: any = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([
          {
            gross: D(300),
            receiptGross: D(300),
            receiptDiscounts: D(0),
            net: D(300),
            tax: D(42),
            total: D(342),
            orders: 2,
            refunds: D(171),
            returnCount: 2,
            taxReturned: D(21),
            soldCost: D(0),
            returnedCost: D(0),
          },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          row("A", 1, 50, 57, 114, 57),
          row("B", 1, 200, 228, 228, 0),
          row("C", 0, -100, -114, 0, 114),
        ]),
    };
    const data = await dashboardData(
      tx,
      { id: "owner", permissions: ["sales.view_all"] } as any,
      from,
      to,
    );
    expect(data.cashiers.map((c: any) => c.id)).toEqual(["B", "A", "C"]);
    expect(data.cashiers.find((c: any) => c.id === "A")).toMatchObject({
      invoices: 1,
      grossSales: "57.00",
      salesWithTax: "114.00",
      returnsWithTax: "57.00",
      netSales: "50.00",
      sellerCode: "A",
    });
    expect(data.cashiers.find((c: any) => c.id === "C")).toMatchObject({
      invoices: 0,
      grossSales: "-114.00",
      salesWithTax: "0.00",
      returnsWithTax: "114.00",
    });
    expect(
      data.cashiers.reduce(
        (sum: number, c: any) => sum + Number(c.grossSales),
        0,
      ),
    ).toBe(Number(data.totalSalesWithTax));
    const query = tx.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(query.values).toContain(from.toISOString());
    expect(query.values).toContain(to.toISOString());
  });
});
