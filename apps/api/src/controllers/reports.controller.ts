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
  const sales = await tx.sale.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      ...(all ? {} : { userId: user.id }),
    },
    include: {
      items: true,
      payments: true,
      user: { select: { id: true, name: true, employeeCode: true } },
    },
  });
  const returned = await tx.saleReturn.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      ...(all ? {} : { sale: { userId: user.id } }),
    },
    include: { items: true },
  });
  const expenses = profit
    ? ((
        await tx.expense.aggregate({
          where: { status: "APPROVED", date: { gte: from, lte: to } },
          _sum: { amount: true },
        })
      )._sum.amount ?? D(0))
    : D(0);
  const gross = sales.reduce(
      (s, v) =>
        s.plus(
          v.taxMode === "INCLUSIVE"
            ? round(v.subtotal.div(D(1).plus(v.taxRate.div(100))))
            : v.subtotal,
        ),
      D(0),
    ),
    discounts = sales.reduce(
      (s, v) =>
        s.plus(
          (v.taxMode === "INCLUSIVE"
            ? round(v.subtotal.div(D(1).plus(v.taxRate.div(100))))
            : v.subtotal
          ).minus(v.netBeforeTax),
        ),
      D(0),
    ),
    tax = sales.reduce((s, v) => s.plus(v.tax), D(0));
  const refunds = returned.reduce((s, v) => s.plus(v.total), D(0));
  // Return tax is reversed proportionally from the original line snapshot.
  const returnItems = await tx.saleReturnItem.findMany({
    where: { returnId: { in: returned.map((r) => r.id) } },
    include: {
      saleItem: {
        include: {
          sale: {
            select: { userId: true, user: { select: { id: true, name: true, employeeCode: true } } },
          },
        },
      },
    },
  });
  const taxReturned = returnItems.reduce((s, v) => s.plus(v.tax), D(0));
  const totalSalesWithTax = sales
    .reduce((s, v) => s.plus(v.total), D(0))
    .minus(refunds);
  const cashierRows = new Map<
    string,
    { id: string; name: string; sellerCode: string; invoices: number; netSales: ReturnType<typeof D>; grossSales: ReturnType<typeof D>; salesWithTax: ReturnType<typeof D>; returnsWithTax: ReturnType<typeof D> }
  >();
  for (const sale of sales) {
    const current = cashierRows.get(sale.userId) ?? {
      id: sale.userId,
      name: sale.user.name,
      sellerCode: sale.user.employeeCode ?? sale.userId.slice(0, 8).toUpperCase(),
      invoices: 0,
      netSales: D(0),
      grossSales: D(0),
      salesWithTax: D(0),
      returnsWithTax: D(0),
    };
    current.invoices += 1;
    current.netSales = current.netSales.plus(sale.netBeforeTax);
    current.grossSales = current.grossSales.plus(sale.total);
    current.salesWithTax = current.salesWithTax.plus(sale.total);
    cashierRows.set(sale.userId, current);
  }
  // Keep each cashier's figures aligned with the dashboard totals: returns
  // reduce the original seller's sales. Net excludes VAT, gross includes it.
  for (const item of returnItems) {
    const sale = item.saleItem.sale;
    const current = cashierRows.get(sale.userId) ?? {
      id: sale.userId,
      name: sale.user.name,
      sellerCode: sale.user.employeeCode ?? sale.userId.slice(0, 8).toUpperCase(),
      invoices: 0,
      netSales: D(0),
      grossSales: D(0),
      salesWithTax: D(0),
      returnsWithTax: D(0),
    };
    current.netSales = current.netSales.minus(D(item.amount).minus(item.tax));
    current.grossSales = current.grossSales.minus(item.amount);
    current.returnsWithTax = current.returnsWithTax.plus(item.amount);
    cashierRows.set(sale.userId, current);
  }
  const netSales = sales
    .reduce((s, v) => s.plus(v.netBeforeTax), D(0))
    .minus(refunds)
    .plus(taxReturned);
  const cogs = sales
    .flatMap((s) => s.items)
    .reduce((s, v) => s.plus(v.unitCost.mul(v.quantity)), D(0))
    .minus(
      returnItems
        .filter((i) => i.sellable)
        .reduce((s, v) => s.plus(v.cost), D(0)),
    );
  const daily: Record<string, { date: string; sales: string }> = {};
  for (const s of sales) {
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
    }).format(s.createdAt);
    daily[date] = {
      date,
      sales: D(daily[date]?.sales ?? 0)
        .plus(s.total)
        .toFixed(2),
    };
  }
  const result: any = {
    grossSales: gross.toFixed(2),
    receiptGrossSales: sales
      .reduce((s, v) => s.plus(v.subtotal), D(0))
      .toFixed(2),
    receiptDiscounts: sales
      .reduce((s, v) => s.plus(v.discount), D(0))
      .toFixed(2),
    totalSalesWithTax: round(totalSalesWithTax).toFixed(2),
    discounts: discounts.toFixed(2),
    returns: refunds.toFixed(2),
    netSales: round(netSales).toFixed(2),
    tax: round(tax.minus(taxReturned)).toFixed(2),
    orders: sales.length,
    returnCount: returned.length,
    daily: Object.values(daily).sort((a, b) => a.date.localeCompare(b.date)),
    cashiers: [...cashierRows.values()]
      .map((row) => ({
        ...row,
        netSales: round(row.netSales).toFixed(2),
        grossSales: round(row.grossSales).toFixed(2),
        salesWithTax: round(row.salesWithTax).toFixed(2),
        returnsWithTax: round(row.returnsWithTax).toFixed(2),
      }))
      .sort((a, b) => Number(b.grossSales) - Number(a.grossSales)),
  };
  const purchaseReturnItems = profit
    ? await tx.purchaseReturnItem.findMany({
        where: { return: { createdAt: { gte: from, lte: to } } },
        select: { inventoryCost: true, amount: true },
      })
    : [];
  const purchaseReturnVariance = purchaseReturnItems.reduce(
    (sum, item) => sum.plus(item.inventoryCost).minus(item.amount),
    D(0),
  );
  const stockDamageCost = profit
    ? ((
        await tx.stockDocument.aggregate({
          where: { type: "DAMAGE", createdAt: { gte: from, lte: to } },
          _sum: { totalCost: true },
        })
      )._sum.totalCost ?? D(0))
    : D(0);
  if (profit)
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
  if (user.permissions.includes("inventory.view")) {
    const balances = await tx.stockBalance.findMany({
      include: { variant: { select: { minStock: true } } },
    });
    result.lowStock = balances.filter(
      (b) => b.quantity <= b.variant.minStock,
    ).length;
    if (profit) {
      result.inventoryValue = round(
        balances.reduce((s, b) => s.plus(b.averageCost.mul(b.quantity)), D(0)),
      ).toFixed(2);
      const transit = await tx.shipmentItem.findMany({
          where: { shipment: { status: { not: "RECEIVED" } } },
        }),
        holds = await tx.stockHold.findMany();
      result.inTransitValue = transit
        .reduce((s, i) => s.plus(i.unitCost.mul(i.quantity - i.received)), D(0))
        .toFixed(2);
      result.quarantineValue = holds
        .reduce(
          (s, i) =>
            s.plus(i.unitCost.mul(i.quantity - i.released - i.disposed)),
          D(0),
        )
        .toFixed(2);
      result.availableInventoryValue = result.inventoryValue;
      result.inventoryValue = D(result.inventoryValue)
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
