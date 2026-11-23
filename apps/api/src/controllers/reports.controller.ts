import { Prisma } from "@prisma/client";
import type { RequestHandler } from "express";
import { z } from "zod";
import ExcelJS from "exceljs";
import { actor } from "../middleware/auth.js";
import { db, assert } from "../lib/db.js";
import { D, round } from "../utils/money.js";

export async function dashboardData(
  tx: import("../lib/db.js").Tx,
  user: import("../middleware/auth.js").Actor,
  from: Date,
  to: Date,
) {
  const all = user.permissions.includes("sales.view_all"),
    profit = user.permissions.includes("reports.profit");
  // Keep the original inclusive bounds and seller scope. Returns are scoped by
  // their own date, not the date of the original sale. Bind UTC strings as
  // timestamp explicitly: Prisma Date parameters otherwise become timestamptz
  // and can shift these timestamp-without-time-zone bounds with session timezone.
  const salesInPeriod = Prisma.sql`
    SELECT s.id, s."userId", s."createdAt", s.subtotal, s.discount,
      s."netBeforeTax", s.tax, s.total, s."taxMode", s."taxRate"
    FROM "Sale" s
    WHERE s."createdAt" >= ${from.toISOString()}::timestamp AND s."createdAt" <= ${to.toISOString()}::timestamp
      ${all ? Prisma.empty : Prisma.sql`AND s."userId" = ${user.id}::uuid`}
  `;
  const returnsInPeriod = Prisma.sql`
    SELECT r.id, r.total FROM "SaleReturn" r
    JOIN "Sale" s ON s.id = r."saleId"
    WHERE r."createdAt" >= ${from.toISOString()}::timestamp AND r."createdAt" <= ${to.toISOString()}::timestamp
      ${all ? Prisma.empty : Prisma.sql`AND s."userId" = ${user.id}::uuid`}
  `;
  type Summary = {
    gross: Prisma.Decimal;
    receiptGross: Prisma.Decimal;
    receiptDiscounts: Prisma.Decimal;
    net: Prisma.Decimal;
    tax: Prisma.Decimal;
    total: Prisma.Decimal;
    orders: number;
    refunds: Prisma.Decimal;
    returnCount: number;
    taxReturned: Prisma.Decimal;
    soldCost: Prisma.Decimal;
    returnedCost: Prisma.Decimal;
  };
  const [summary] = await tx.$queryRaw<Summary[]>(Prisma.sql`
    WITH sales AS (${salesInPeriod}), returns AS (${returnsInPeriod})
    SELECT
      COALESCE(SUM(CASE WHEN "taxMode" = 'INCLUSIVE'
        THEN ROUND(subtotal / (1 + "taxRate" / 100), 2)
        ELSE subtotal END), 0) AS gross,
      COALESCE(SUM(subtotal), 0) AS "receiptGross",
      COALESCE(SUM(discount), 0) AS "receiptDiscounts",
      COALESCE(SUM("netBeforeTax"), 0) AS net,
      COALESCE(SUM(tax), 0) AS tax,
      COALESCE(SUM(total), 0) AS total, COUNT(*)::int AS orders,
      (SELECT COALESCE(SUM(total), 0) FROM returns) AS refunds,
      (SELECT COUNT(*)::int FROM returns) AS "returnCount",
      (SELECT COALESCE(SUM(i.tax), 0) FROM "SaleReturnItem" i
        JOIN returns r ON r.id = i."returnId") AS "taxReturned",
      (SELECT COALESCE(SUM(i."unitCost" * i.quantity), 0)
        FROM "SaleItem" i JOIN sales s ON s.id = i."saleId") AS "soldCost",
      (SELECT COALESCE(SUM(i.cost), 0) FROM "SaleReturnItem" i
        JOIN returns r ON r.id = i."returnId" WHERE i.sellable) AS "returnedCost"
    FROM sales
  `);
  const totals = summary!;
  const netSales = totals.net.minus(totals.refunds).plus(totals.taxReturned);
  const cogs = totals.soldCost.minus(totals.returnedCost);
  const daily = await tx.$queryRaw<
    { date: string; sales: string }[]
  >(Prisma.sql`
    WITH sales AS (${salesInPeriod})
    SELECT TO_CHAR("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo',
      'YYYY-MM-DD') AS date,
      SUM(total)::numeric(30,2)::text AS sales
    FROM sales GROUP BY 1 ORDER BY 1
  `);
  type Cashier = {
    id: string;
    name: string;
    sellerCode: string;
    invoices: number;
    netSales: Prisma.Decimal;
    grossSales: Prisma.Decimal;
    salesWithTax: Prisma.Decimal;
    returnsWithTax: Prisma.Decimal;
  };
  const cashiers = await tx.$queryRaw<Cashier[]>(Prisma.sql`
    WITH sales AS (${salesInPeriod}), returns AS (${returnsInPeriod}),
    entries AS (
      SELECT "userId", COUNT(*)::int AS invoices,
        SUM("netBeforeTax") AS net, SUM(total) AS gross,
        SUM(total) AS sales, 0::numeric AS refunds
      FROM sales GROUP BY "userId"
      UNION ALL
      SELECT s."userId", 0, -SUM(i.amount - i.tax), -SUM(i.amount),
        0::numeric, SUM(i.amount)
      FROM "SaleReturnItem" i JOIN returns r ON r.id = i."returnId"
      JOIN "SaleItem" si ON si.id = i."saleItemId"
      JOIN "Sale" s ON s.id = si."saleId" GROUP BY s."userId"
    )
    SELECT u.id, u.name,
      COALESCE(u."employeeCode", UPPER(LEFT(u.id::text, 8))) AS "sellerCode",
      SUM(e.invoices)::int AS invoices, SUM(e.net) AS "netSales",
      SUM(e.gross) AS "grossSales", SUM(e.sales) AS "salesWithTax",
      SUM(e.refunds) AS "returnsWithTax"
    FROM entries e JOIN "User" u ON u.id = e."userId"
    GROUP BY u.id, u.name, u."employeeCode"
  `);
  const result: any = {
    grossSales: totals.gross.toFixed(2),
    receiptGrossSales: totals.receiptGross.toFixed(2),
    receiptDiscounts: totals.receiptDiscounts.toFixed(2),
    totalSalesWithTax: round(totals.total.minus(totals.refunds)).toFixed(2),
    discounts: totals.gross.minus(totals.net).toFixed(2),
    returns: totals.refunds.toFixed(2),
    netSales: round(netSales).toFixed(2),
    tax: round(totals.tax.minus(totals.taxReturned)).toFixed(2),
    orders: totals.orders,
    returnCount: totals.returnCount,
    daily,
    cashiers: cashiers
      .map((row) => ({
        ...row,
        netSales: round(row.netSales).toFixed(2),
        grossSales: round(row.grossSales).toFixed(2),
        salesWithTax: round(row.salesWithTax).toFixed(2),
        returnsWithTax: round(row.returnsWithTax).toFixed(2),
      }))
      .sort((a, b) => Number(b.grossSales) - Number(a.grossSales)),
  };
  if (profit) {
    const expenses =
      (
        await tx.expense.aggregate({
          where: { status: "APPROVED", date: { gte: from, lte: to } },
          _sum: { amount: true },
        })
      )._sum.amount ?? D(0);
    const [purchaseReturns] = await tx.$queryRaw<
      { variance: Prisma.Decimal }[]
    >(Prisma.sql`
      SELECT COALESCE(SUM(i."inventoryCost" - i.amount), 0) AS variance
      FROM "PurchaseReturnItem" i
      JOIN "PurchaseReturn" r ON r.id = i."returnId"
      WHERE r."createdAt" >= ${from.toISOString()}::timestamp AND r."createdAt" <= ${to.toISOString()}::timestamp
    `);
    const purchaseReturnVariance = purchaseReturns!.variance;
    const stockDamageCost =
      (
        await tx.stockDocument.aggregate({
          where: { type: "DAMAGE", createdAt: { gte: from, lte: to } },
          _sum: { totalCost: true },
        })
      )._sum.totalCost ?? D(0);
    Object.assign(result, {
      costOfGoodsSold: round(cogs).toFixed(2),
      grossProfit: round(netSales.minus(cogs)).toFixed(2),
      expenses: expenses.toFixed(2),
      stockDamageCost: stockDamageCost.toFixed(2),
      purchaseReturnVariance: round(purchaseReturnVariance).toFixed(2),
      netProfit: round(
        netSales
          .minus(cogs)
          .minus(expenses)
          .minus(stockDamageCost)
          .minus(purchaseReturnVariance),
      ).toFixed(2),
    });
  }
  if (user.permissions.includes("inventory.view")) {
    const [stock] = await tx.$queryRaw<
      {
        lowStock: number;
        value: Prisma.Decimal;
      }[]
    >(Prisma.sql`
      SELECT COUNT(*) FILTER (WHERE b.quantity <= v."minStock")::int AS "lowStock",
        COALESCE(SUM(b."averageCost" * b.quantity), 0) AS value
      FROM "StockBalance" b JOIN "ProductVariant" v ON v.id = b."variantId"
    `);
    result.lowStock = stock!.lowStock;
    if (profit) {
      const [inventory] = await tx.$queryRaw<
        {
          transit: Prisma.Decimal;
          quarantine: Prisma.Decimal;
        }[]
      >(Prisma.sql`
        SELECT (SELECT COALESCE(SUM(i."unitCost" * (i.quantity - i.received)), 0)
          FROM "ShipmentItem" i JOIN "Shipment" s ON s.id = i."shipmentId"
          WHERE s.status <> 'RECEIVED') AS transit,
          (SELECT COALESCE(SUM("unitCost" * (quantity - released - disposed)), 0)
          FROM "StockHold") AS quarantine
      `);
      result.availableInventoryValue = round(stock!.value).toFixed(2);
      result.inTransitValue = inventory!.transit.toFixed(2);
      result.quarantineValue = inventory!.quarantine.toFixed(2);
      // Preserve the original order of rounding before combining valuations.
      result.inventoryValue = D(result.availableInventoryValue)
        .plus(result.inTransitValue)
        .plus(result.quarantineValue)
        .toFixed(2);
    }
  }
  return result;
}

export const handleGetDashboard: RequestHandler = async (req, res, next) => {
    try {
      const from = z.coerce
          .date()
          .default(new Date(Date.now() - 30 * 86400000))
          .parse(req.query.from),
        to = z.coerce.date().default(new Date()).parse(req.query.to);
      assert(
        from <= to && to.getTime() - from.getTime() <= 366 * 86400000,
        "DATE_RANGE",
        "Select a date range of at most 366 days",
        400,
      );
      const data = await db.$transaction(
        async (tx) => {
          return dashboardData(tx, actor(req), from, to);
        },
        { isolationLevel: "RepeatableRead" },
      );
      res.json({ data });
    } catch (e) {
      next(e);
    }
  };

export const handleGetSalesExport: RequestHandler = async (req, res, next) => {
  try {
    const from = z.coerce.date().parse(req.query.from),
      to = z.coerce.date().parse(req.query.to);
    assert(
      from <= to && to.getTime() - from.getTime() <= 366 * 86400000,
      "DATE_RANGE",
      "Select a range of at most 366 days",
      400,
    );
    const rows = await db.sale.findMany({
      where: {
        createdAt: { gte: from, lte: to },
        ...(actor(req).permissions.includes("sales.view_all")
          ? {}
          : { userId: actor(req).id }),
      },
      orderBy: { createdAt: "asc" },
      take: 10001,
    });
    assert(
      rows.length <= 10000,
      "EXPORT_LIMIT",
      "Narrow the date range to 10,000 invoices or fewer",
      400,
    );
    const workbook = new ExcelJS.Workbook(),
      sheet = workbook.addWorksheet("المبيعات", {
        views: [{ rightToLeft: true }],
      });
    sheet.columns = [
      { header: "الفاتورة", key: "number", width: 18 },
      { header: "التاريخ", key: "date", width: 28 },
      { header: "الإجمالي", key: "total", width: 20 },
      { header: "الخصم", key: "discount", width: 20 },
      { header: "الحالة", key: "status", width: 24 },
    ];
    rows.forEach((s) =>
      sheet.addRow({
        number: s.number.toString(),
        date: s.createdAt.toISOString(),
        total: s.total.toFixed(2),
        discount: s.discount.toFixed(2),
        status: s.status,
      }),
    );
    sheet.getRow(1).font = { bold: true };
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="az-sales.xlsx"',
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (e) {
    next(e);
  }
};
