import { userOptions } from "../services/user-options.js";
import { page } from "../utils/http.js";
import { listResult } from "../utils/pagination.js";
import type { RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import ExcelJS from "exceljs";
import { actor, type Actor } from "../middleware/auth.js";
import { db, assert } from "../lib/db.js";
import { dashboardData } from "../routes/reports.js";
import { reportPdf } from "../utils/report-pdf.js";
import { D } from "../utils/money.js";
import { reportDate } from "../utils/report-date.js";

const types = [
  "daily",
  "monthly",
  "category",
  "product",
  "variant",
  "cashier",
  "cashier-invoices",
  "payments",
  "returns",
  "discounts",
  "purchases",
  "suppliers",
  "inventory",
  "low-stock",
  "movements",
  "expenses",
  "gross-profit",
  "net-profit",
  "shifts",
] as const;

type Column = { key: string; label: string };

const columns = (...values: string[]): Column[] =>
  values.map((v) => {
    const [key, label] = v.split(":");
    return { key: key!, label: label! };
  });

export const reportTitles: Record<string, string> = {
  daily: "المبيعات اليومية",
  monthly: "المبيعات الشهرية",
  category: "المبيعات حسب التصنيف",
  product: "المبيعات حسب المنتج",
  variant: "المبيعات حسب المقاس واللون",
  cashier: "المبيعات حسب الكاشير",
  "cashier-invoices": "فواتير الكاشير خلال الفترة",
  payments: "تحصيل المبيعات حسب طريقة الدفع",
  returns: "المرتجعات",
  discounts: "الخصومات",
  purchases: "فواتير استلام المشتريات",
  suppliers: "أرصدة الموردين الحالية",
  inventory: "تقييم المخزون الحالي",
  "low-stock": "المخزون المنخفض الحالي",
  movements: "حركات المخزون",
  expenses: "المصروفات",
  "gross-profit": "مجمل الربح",
  "net-profit": "صافي الربح",
  shifts: "ورديات درج المحل",
};

function authority(kind: string, user: Actor) {
  const has = (k: string) => user.permissions.includes(k);
  if (["gross-profit", "net-profit", "suppliers", "purchases"].includes(kind))
    assert(
      has("reports.profit"),
      "FORBIDDEN",
      "صلاحية الأرباح مطلوبة لهذا التقرير",
      403,
    );
  if (kind === "purchases")
    assert(has("purchases.view"), "FORBIDDEN", "غير مسموح", 403);
  if (kind === "suppliers")
    assert(has("suppliers.manage"), "FORBIDDEN", "غير مسموح", 403);
  if (kind === "expenses")
    assert(has("expenses.view"), "FORBIDDEN", "غير مسموح", 403);
  if (["inventory", "low-stock", "movements"].includes(kind))
    assert(
      has("inventory.view") || has("reports.inventory"),
      "FORBIDDEN",
      "غير مسموح",
      403,
    );
  if (kind === "shifts")
    assert(has("cash.close_shift"), "FORBIDDEN", "غير مسموح", 403);
}

function queryFor(
  kind: string,
  from: Date,
  to: Date,
  user: Actor,
  cashierId?: string,
): { sql: Prisma.Sql; columns: Column[] } {
  const scope = user.permissions.includes("sales.view_all")
    ? Prisma.empty
    : Prisma.sql`AND s."userId"=${user.id}::uuid`;
  const profit = user.permissions.includes("reports.profit");
  if (kind === "cashier-invoices") {
    assert(cashierId, "CASHIER_REQUIRED", "اختر الكاشير أولاً", 400);
    return {
      sql: Prisma.sql`SELECT s."receiptNumber" label,s."createdAt" date,u.name cashier,s.subtotal::text gross,s.discount::text discount,s."netBeforeTax"::text net,s.tax::text tax,s.total::text total FROM "Sale" s JOIN "User" u ON u.id=s."userId" WHERE s."createdAt">=${from} AND s."createdAt"<=${to} AND s."userId"=${cashierId}::uuid ${scope}`,
      columns: columns(
        "label:رقم الفاتورة",
        "date:التاريخ والوقت",
        "cashier:الكاشير",
        "gross:قبل الخصم",
        "discount:الخصم",
        "net:المبيعات بدون الضريبة",
        "tax:الضريبة",
        "total:شامل الضريبة",
      ),
    };
  }
  if (
    ["daily", "monthly", "category", "product", "variant", "cashier"].includes(
      kind,
    )
  ) {
    const group =
      kind === "daily"
        ? Prisma.sql`to_char(e.at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo','YYYY-MM-DD')`
        : kind === "monthly"
          ? Prisma.sql`to_char(e.at AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo','YYYY-MM')`
          : kind === "category"
            ? Prisma.sql`e.category`
            : kind === "cashier"
              ? Prisma.sql`u.name || ' [' || substring(u.id::text,1,8) || ']'`
              : kind === "variant"
                ? Prisma.sql`e.sku || ' • ' || e.name || COALESCE((SELECT ' • ' || string_agg(option.key || ': ' || option.value, '، ' ORDER BY option.key) FROM jsonb_each_text(e.options::jsonb) AS option), '')`
                : Prisma.sql`e.name`;
    return {
      sql: Prisma.sql`WITH e AS (
   SELECT si.name,si.sku,si.options,si."categoryName" category,s."userId" uid,s."createdAt" at,si.quantity,
    si.total-si.tax net,si.tax,COALESCE(si."costTotal", si."unitCost" * si.quantity) cost
   FROM "SaleItem" si JOIN "Sale" s ON s.id=si."saleId" WHERE s."createdAt">=${from} AND s."createdAt"<=${to} ${scope}
   UNION ALL
   SELECT si.name,si.sku,si.options,si."categoryName",s."userId",r."createdAt",-ri.quantity,-(ri.amount-ri.tax),-ri.tax,CASE WHEN ri.sellable THEN -ri.cost ELSE 0 END
   FROM "SaleReturnItem" ri JOIN "SaleReturn" r ON r.id=ri."returnId" JOIN "SaleItem" si ON si.id=ri."saleItemId" JOIN "Sale" s ON s.id=si."saleId"
   WHERE r."createdAt">=${from} AND r."createdAt"<=${to} ${scope}
  ) SELECT ${group} label,SUM(e.quantity)::text quantity,ROUND(SUM(e.net),2)::text net,ROUND(SUM(e.tax),2)::text tax,ROUND(SUM(e.net+e.tax),2)::text total ${profit ? Prisma.sql`,ROUND(SUM(e.cost),2)::text cost,ROUND(SUM(e.net-e.cost),2)::text profit` : Prisma.empty}
   FROM e JOIN "User" u ON u.id=e.uid GROUP BY 1`,
      columns: columns(
        "label:البيان",
        "quantity:صافي القطع",
        "net:الصافي قبل الضريبة",
        "tax:الضريبة",
        "total:شامل الضريبة",
        ...(profit ? ["cost:تكلفة المباع", "profit:مجمل الربح"] : []),
      ),
    };
  }
  if (kind === "payments")
    return {
      sql: Prisma.sql`SELECT method label,COUNT(*)::text count,ROUND(SUM(amount-CASE WHEN method='CASH' THEN change ELSE 0 END),2)::text amount FROM (SELECT p.method,s.id,s.change,SUM(p.amount) amount FROM "SalePayment" p JOIN "Sale" s ON s.id=p."saleId" WHERE s."createdAt">=${from} AND s."createdAt"<=${to} ${scope} GROUP BY p.method,s.id,s.change) payments GROUP BY method`,
      columns: columns(
        "label:طريقة الدفع",
        "count:عدد الفواتير",
        "amount:تحصيل المبيعات بعد الباقي",
      ),
    };
  if (kind === "returns")
    return {
      sql: Prisma.sql`SELECT r.id::text label,s."receiptNumber" receipt,r."createdAt" date,r.reason,r.total::text amount,r."refundAmount"::text refund,r."creditAmount"::text credit FROM "SaleReturn" r JOIN "Sale" s ON s.id=r."saleId" WHERE r."createdAt">=${from} AND r."createdAt"<=${to} ${scope}`,
      columns: columns(
        "label:مرجع المرتجع",
        "receipt:الفاتورة",
        "date:التاريخ",
        "reason:السبب",
        "amount:قيمة البضاعة",
        "refund:رد خارجي",
        "credit:رصيد استبدال",
      ),
    };
  if (kind === "discounts")
    return {
      sql: Prisma.sql`SELECT s."receiptNumber" label,s."createdAt" date,u.name cashier,s.subtotal::text gross,s.discount::text discount,s.total::text total FROM "Sale" s JOIN "User" u ON u.id=s."userId" WHERE s.discount>0 AND s."createdAt">=${from} AND s."createdAt"<=${to} ${scope}`,
      columns: columns(
        "label:الفاتورة",
        "date:التاريخ",
        "cashier:الكاشير",
        "gross:قبل الخصم",
        "discount:إجمالي الخصومات",
        "total:المستحق",
      ),
    };
  if (kind === "purchases")
    return {
      sql: Prisma.sql`SELECT i.number::text label,s.name supplier,i."createdAt" date,i.total::text amount,COALESCE((SELECT SUM(r.total) FROM "PurchaseReturn" r WHERE r."invoiceId"=i.id),0)::text returned FROM "SupplierInvoice" i JOIN "Supplier" s ON s.id=i."supplierId" WHERE i."createdAt">=${from} AND i."createdAt"<=${to}`,
      columns: columns(
        "label:فاتورة المورد",
        "supplier:المورد",
        "date:تاريخ الاستلام",
        "amount:القيمة الأصلية",
        "returned:مرتجعات الفاتورة حتى الآن",
      ),
    };
  if (kind === "suppliers")
    return {
      sql: Prisma.sql`SELECT s.name label,s.phone,s."openingBalance"::text opening,(s."openingBalance"+COALESCE((SELECT SUM(total) FROM "SupplierInvoice" WHERE "supplierId"=s.id),0)-COALESCE((SELECT SUM(amount) FROM "SupplierPayment" WHERE "supplierId"=s.id),0)-COALESCE((SELECT SUM(total) FROM "PurchaseReturn" WHERE "supplierId"=s.id),0))::text balance FROM "Supplier" s`,
      columns: columns(
        "label:المورد",
        "phone:الهاتف",
        "opening:افتتاحي",
        "balance:الرصيد الحالي المستحق",
      ),
    };
  if (kind === "inventory" || kind === "low-stock") {
    const available = Prisma.sql`SELECT v.sku label,p."nameAr" product,l.name location,'متاح' status,b.quantity::text quantity,v."minStock"::text minimum ${profit ? Prisma.sql`,b."averageCost"::text cost,ROUND(b."averageCost"*b.quantity,2)::text value` : Prisma.empty} FROM "StockBalance" b JOIN "ProductVariant" v ON v.id=b."variantId" JOIN "Product" p ON p.id=v."productId" JOIN "StockLocation" l ON l.id=b."locationId" ${kind === "low-stock" ? Prisma.sql`WHERE b.quantity<=v."minStock"` : Prisma.empty}`;
    const held = Prisma.sql`SELECT v.sku,p."nameAr",l.name,'محجور',(h.quantity-h.released-h.disposed)::text,v."minStock"::text ${profit ? Prisma.sql`,h."unitCost"::text,ROUND(h."unitCost"*(h.quantity-h.released-h.disposed),2)::text` : Prisma.empty} FROM "StockHold" h JOIN "ProductVariant" v ON v.id=h."variantId" JOIN "Product" p ON p.id=v."productId" JOIN "StockLocation" l ON l.id=h."locationId" WHERE h.quantity>h.released+h.disposed`;
    const transit = Prisma.sql`SELECT v.sku,p."nameAr",l.name||' ← '||d.name,'بالطريق',(i.quantity-i.received)::text,v."minStock"::text ${profit ? Prisma.sql`,i."unitCost"::text,ROUND(i."unitCost"*(i.quantity-i.received),2)::text` : Prisma.empty} FROM "ShipmentItem" i JOIN "Shipment" s ON s.id=i."shipmentId" JOIN "ProductVariant" v ON v.id=i."variantId" JOIN "Product" p ON p.id=v."productId" JOIN "StockLocation" l ON l.id=s."sourceId" JOIN "StockLocation" d ON d.id=s."destinationId" WHERE i.quantity>i.received`;
    return {
      sql:
        kind === "low-stock"
          ? available
          : Prisma.sql`${available} UNION ALL ${held} UNION ALL ${transit}`,
      columns: columns(
        "label:SKU",
        "product:المنتج",
        "location:المخزن أو المسار",
        "status:حالة الرصيد",
        "quantity:الكمية الحالية",
        "minimum:الحد الأدنى",
        ...(profit ? ["cost:تكلفة الوحدة", "value:قيمة الرصيد"] : []),
      ),
    };
  }
  if (kind === "movements")
    return {
      sql: Prisma.sql`SELECT v.sku label,l.name location,m."createdAt" date,m.type,m.quantity::text quantity,m.reference,m.reason ${profit ? Prisma.sql`,m."unitCost"::text cost` : Prisma.empty} FROM "StockMovement" m JOIN "ProductVariant" v ON v.id=m."variantId" JOIN "StockLocation" l ON l.id=m."locationId" WHERE m."createdAt">=${from} AND m."createdAt"<=${to}`,
      columns: columns(
        "label:SKU",
        "location:المخزن",
        "date:التاريخ",
        "type:الحركة",
        "quantity:الكمية",
        "reference:المستند",
        "reason:السبب",
        ...(profit ? ["cost:تكلفة الوحدة"] : []),
      ),
    };
  if (kind === "expenses")
    return {
      sql: Prisma.sql`SELECT e.id::text label,e.category,e.date,e.description,e.status,e.method,e.amount::text amount FROM "Expense" e WHERE e.date>=${from} AND e.date<=${to}`,
      columns: columns(
        "label:مرجع المصروف",
        "category:التصنيف",
        "date:التاريخ",
        "description:الوصف",
        "status:الحالة",
        "method:الدفع",
        "amount:القيمة",
      ),
    };
  return {
    sql: Prisma.sql`SELECT r.name label,u.name cashier,s."openedAt" opened,s."closedAt" closed,s."openingCash"::text opening,s."expectedCash"::text expected,s."countedCash"::text counted,s.difference::text difference FROM "CashShift" s JOIN "User" u ON u.id=s."userId" JOIN "Register" r ON r.id=s."registerId" WHERE s."openedAt">=${from} AND s."openedAt"<=${to} `,
    columns: columns(
      "label:الجهاز",
      "cashier:فتح بواسطة",
      "opened:فتح",
      "closed:إغلاق",
      "opening:افتتاحي",
      "expected:المتوقع",
      "counted:المعدود",
      "difference:الفرق",
    ),
  };
}

export const handleGetReportsCashiers: RequestHandler = async (req, res, next) => {
    try {
      const user = actor(req);
      if(req.query.offset!==undefined || req.query.q!==undefined || req.query.selected!==undefined){res.json(await userOptions(req.query,user.permissions.includes("sales.view_all")?{active:true}:{id:user.id}));return;}
      const users = await db.user.findMany({
        where: user.permissions.includes("sales.view_all")
          ? { active: true }
          : { id: user.id },
        select: { id: true, name: true, employeeCode: true },
        orderBy: { name: "asc" },
      });
      res.json({
        data: users.map((u) => ({
          ...u,
          sellerCode: u.employeeCode ?? u.id.slice(0, 8).toUpperCase(),
        })),
      });
    } catch (error) {
      next(error);
    }
  };

export const handleGetReportsDetailByKind: RequestHandler = async (req, res, next) => {
    try {
      const kind = z.enum(types).parse(req.params.kind),
        from = z.coerce.date().parse(req.query.from),
        to = z.coerce.date().parse(req.query.to),
        q = z.string().max(100).default("").parse(req.query.q),
        cashierId = z.string().uuid().optional().parse(req.query.cashierId),
        offset = page(req.query).skip,
        format = z
          .enum(["json", "xlsx", "pdf"])
          .default("json")
          .parse(req.query.format);
      assert(
        from <= to && to.getTime() - from.getTime() <= 366 * 86400000,
        "DATE_RANGE",
        "اختار فترة لا تتجاوز 366 يومًا",
        400,
      );
      authority(kind, actor(req));
      assert(
        actor(req).permissions.includes("reports.sales") ||
          ["inventory", "low-stock", "movements"].includes(kind),
        "FORBIDDEN",
        "غير مسموح",
        403,
      );
      const take = format === "json" ? page(req.query).take : 10001;
      const result = await db.$transaction(
        async (tx) => {
          if (kind === "gross-profit" || kind === "net-profit") {
            const d = await dashboardData(tx, actor(req), from, to);
            const cols = columns(
              "grossSales:قبل الخصم",
              "discounts:الخصومات",
              "returns:المرتجعات شاملة الضريبة",
              "netSales:صافي المبيعات قبل الضريبة",
              "tax:صافي الضريبة",
              "costOfGoodsSold:تكلفة المباع",
              "grossProfit:مجمل الربح",
              ...(kind === "net-profit"
                ? [
                    "expenses:مصروفات معتمدة",
                    "stockDamageCost:شطب تالف",
                    "purchaseReturnVariance:فرق تكلفة مرتجع المورد",
                    "netProfit:صافي الربح",
                  ]
                : []),
            );
            return { data: [d], total: 1, columns: cols };
          }
          const report = queryFor(kind, from, to, actor(req), cashierId);
          const filter = q
            ? Prisma.sql`WHERE row_to_json(t)::text ILIKE ${`%${q}%`}`
            : Prisma.empty;
          const count = await tx.$queryRaw<{ total: bigint }[]>(
            Prisma.sql`SELECT COUNT(*) total FROM (${report.sql}) t ${filter}`,
          );
          const rows = await tx.$queryRaw<Record<string, unknown>[]>(
            Prisma.sql`SELECT * FROM (${report.sql}) t ${filter} ORDER BY t.label::text, row_to_json(t)::text LIMIT ${take} OFFSET ${format === "json" ? offset : 0}`,
          );
          if (kind === "cashier") {
            const setting = await tx.systemSetting.findUnique({ where: { key: "store" } });
            const rate = D(String((setting?.value as Record<string, unknown>)?.cashierCommissionRate ?? "1"));
            return {
              data: rows.map(row => {
                // A negative net period (returns above sales) floors the commission at zero.
                const base = D(String(row.total ?? "0"));
                return {...row, commissionRate: rate.toFixed(2), commission: (base.isNegative() ? D(0) : base).mul(rate).div(100).toFixed(2)};
              }),
              total: Number(count[0]!.total), columns: [...report.columns, ...columns("commissionRate:العمولة (%)", "commission:قيمة العمولة")],
            };
          }
          return {
            data: rows,
            total: Number(count[0]!.total),
            columns: report.columns,
          };
        },
        { isolationLevel: "RepeatableRead", timeout: 30000 },
      );
      const translations: Record<string, string> = {
        APPROVED: "معتمد",
        PENDING: "قيد المراجعة",
        REJECTED: "مرفوض",
        COMPLETED: "مكتمل",
        CASH: "نقدي",
        CARD: "بطاقة",
        WALLET: "محفظة",
        BANK: "تحويل بنكي",
      };
      const data = result.data.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [
            k,
            v instanceof Date
              ? new Intl.DateTimeFormat("ar-EG-u-nu-latn", {
                  timeZone: "Africa/Cairo",
                  dateStyle: "short",
                  timeStyle: "short",
                }).format(v)
              : v === null
                ? "—"
                : ["status", "method"].includes(k) ||
                    (kind === "payments" && k === "label")
                  ? (translations[String(v)] ?? String(v))
                  : String(v),
          ]),
        ),
      );
      if (format === "json") {
        res.json({ ...result, ...listResult(req.query,data,result.total), title: reportTitles[kind] });
        return;
      }
      assert(
        result.total <= 10000,
        "EXPORT_LIMIT",
        "اختار بحثًا أو فترة أضيق؛ حد التصدير 10000 صف",
        400,
      );
      if (format === "pdf") {
        await reportPdf(
          res,
          reportTitles[kind]!,
          result.columns,
          data,
          `${reportDate(from)} — ${reportDate(to)} | ${["inventory", "low-stock", "suppliers"].includes(kind) ? "أرصدة حالية وقت إصدار التقرير" : "حركات الفترة المحددة"}`,
        );
        return;
      }
      const workbook = new ExcelJS.Workbook(),
        sheet = workbook.addWorksheet("التقرير", {
          views: [{ rightToLeft: true }],
        });
      sheet.columns = result.columns.map((c) => ({
        header: c.label,
        key: c.key,
        width: 26,
      }));
      const numeric = new Set([
        "quantity",
        "net",
        "commissionRate",
        "commission",
        "tax",
        "total",
        "cost",
        "profit",
        "count",
        "amount",
        "refund",
        "credit",
        "gross",
        "discount",
        "returned",
        "balance",
        "opening",
        "minimum",
        "value",
        "expected",
        "counted",
        "difference",
        "grossSales",
        "discounts",
        "returns",
        "netSales",
        "costOfGoodsSold",
        "grossProfit",
        "expenses",
        "stockDamageCost",
        "purchaseReturnVariance",
        "netProfit",
      ]);
      data.forEach((row) =>
        sheet.addRow(
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key,
              numeric.has(key) &&
              /^-?\d+(\.\d+)?$/.test(value) &&
              Math.abs(Number(value)) < Number.MAX_SAFE_INTEGER / 100
                ? Number(value)
                : value,
            ]),
          ),
        ),
      );
      for (const col of sheet.columns)
        if (numeric.has(String(col.key))) col.numFmt = "#,##0.00";
      sheet.getRow(1).font = { bold: true };
      res.set({
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="az-report.xlsx"',
        "Cache-Control": "no-store",
      });
      await workbook.xlsx.write(res);
      res.end();
    } catch (e) {
      next(e);
    }
  };
