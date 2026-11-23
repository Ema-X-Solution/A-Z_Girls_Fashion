import { pagination, paginated } from "../utils/pagination.js";
import { Router } from "express";
import { z } from "zod";
import { actor, requirePermission } from "../middleware/auth.js";
import { assert, audit, db, json, transaction, type Tx } from "../lib/db.js";
import { dashboardData } from "../controllers/reports.controller.js";
import { D, allocate } from "../utils/money.js";
// Presentation alternatives only. Partner distributions remain based on netProfit.
export function profitTaxViews<T extends Record<string, unknown>>(figures: T) {
  const profit = D(String(figures.netProfit ?? "0"));
  const tax = D(String(figures.tax ?? "0"));
  return {
    ...figures,
    profitPlusSalesVat: profit.plus(tax).toFixed(2),
    profitMinusSalesVat: profit.minus(tax).toFixed(2),
  };
}
export const accounting = Router();
accounting.use("/accounting", requirePermission("reports.profit"));
const partnerSchema = z
  .array(
    z
      .object({
        name: z.string().trim().min(1).max(100),
        percent: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/),
      })
      .strict(),
  )
  .min(1)
  .max(30)
  .refine(
    (rows) => rows.reduce((s, r) => s.plus(r.percent), D(0)).eq(100),
    "مجموع نسب الشركاء لازم يساوي 100%",
  )
  .refine(
    (rows) => new Set(rows.map((r) => r.name)).size === rows.length,
    "أسماء الشركاء مكررة",
  );
const periodSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  quarter: z.coerce.number().int().min(1).max(4),
});
function cairoDay(year: number, month: number) {
  const target = `${year}-${String(month).padStart(2, "0")}-01`;
  const center = Date.parse(target + "T00:00:00Z");
  let low = center - 18 * 3600000,
    high = center + 18 * 3600000;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (fmt.format(mid) >= target) high = mid;
    else low = mid;
  }
  return new Date(high);
}
export function quarterBounds(year: number, quarter: number) {
  const month = (quarter - 1) * 3 + 1;
  return {
    startsAt: cairoDay(year, month),
    endsAt: quarter === 4 ? cairoDay(year + 1, 1) : cairoDay(year, month + 3),
  };
}
export async function accountingPreview(
  tx: Tx,
  user: ReturnType<typeof actor>,
  year: number,
  quarter: number,
) {
  const bounds = quarterBounds(year, quarter);
  const closed = await tx.accountingClose.findUnique({
    where: { startsAt_endsAt: bounds },
  });
  if (closed)
    return {
      ...(closed.snapshot as unknown as {
        year: number;
        quarter: number;
        startsAt: Date;
        endsAt: Date;
        figures: Record<string, string>;
        partners: { name: string; percent: string; share: string }[];
      }),
      figures: profitTaxViews(
        (closed.snapshot as unknown as { figures: Record<string, unknown> })
          .figures,
      ),
      closed: true,
      id: closed.id,
      createdAt: closed.createdAt,
    };
  const setting = await tx.systemSetting.findUnique({
    where: { key: "profitPartners" },
  });
  const partners = setting ? partnerSchema.parse(setting.value) : [];
  const report = await dashboardData(
    tx,
    { ...user, permissions: [...user.permissions, "sales.view_all"] },
    bounds.startsAt,
    new Date(bounds.endsAt.getTime() - 1),
  );
  const figures = profitTaxViews(
    Object.fromEntries(
      [
        "grossSales",
        "netSales",
        "discounts",
        "returns",
        "tax",
        "orders",
        "returnCount",
        "costOfGoodsSold",
        "grossProfit",
        "expenses",
        "stockDamageCost",
        "purchaseReturnVariance",
        "netProfit",
      ].map((key) => [key, report[key]]),
    ),
  );
  const net = D(figures.netProfit);
  const shares = allocate(
    net.abs(),
    partners.map((p) => D(p.percent)),
  ).map((v) => (net.lt(0) ? v.negated() : v));
  return {
    closed: false,
    year,
    quarter,
    ...bounds,
    figures,
    partners: partners.map((p, i) => ({ ...p, share: shares[i]!.toFixed(2) })),
  };
}
accounting.get("/accounting/partners", async (_req, res, next) => {
  try {
    res.json({
      data:
        (
          await db.systemSetting.findUnique({
            where: { key: "profitPartners" },
          })
        )?.value ?? [],
    });
  } catch (e) {
    next(e);
  }
});
accounting.post("/accounting/partners", async (req, res, next) => {
  try {
    assert(
      actor(req).roles.includes("OWNER"),
      "FORBIDDEN",
      "تعديل الشركاء للمالك فقط",
      403,
    );
    const partners = partnerSchema.parse(req.body);
    await transaction(async (tx) => {
      await tx.systemSetting.upsert({
        where: { key: "profitPartners" },
        create: { key: "profitPartners", value: partners },
        update: { value: partners },
      });
      await audit(
        tx,
        actor(req).id,
        "PARTNERS_SET",
        "profitPartners",
        partners,
      );
    });
    res.json({ data: partners });
  } catch (e) {
    next(e);
  }
});
accounting.get("/accounting/period", async (req, res, next) => {
  try {
    const p = periodSchema.parse(req.query);
    res.json({
      data: await transaction((tx) =>
        accountingPreview(tx, actor(req), p.year, p.quarter),
      ),
    });
  } catch (e) {
    next(e);
  }
});
accounting.get("/accounting/closings", async (_req, res, next) => {
  try {
    res.json({
      data: await db.accountingClose.findMany({
        orderBy: { startsAt: "desc" },
        take: 100,
      }),
    });
  } catch (e) {
    next(e);
  }
});
accounting.post("/accounting/close", async (req, res, next) => {
  try {
    assert(
      actor(req).roles.includes("OWNER"),
      "FORBIDDEN",
      "الإقفال للمالك فقط",
      403,
    );
    const p = periodSchema
      .extend({ confirm: z.literal(true) })
      .strict()
      .parse(req.body);
    const result = await transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(98125731)`;
      const snapshot = await accountingPreview(
        tx,
        actor(req),
        p.year,
        p.quarter,
      );
      if (snapshot.closed) return snapshot;
      assert(
        snapshot.endsAt! <= new Date(),
        "PERIOD_NOT_ENDED",
        "انتظر نهاية الربع قبل الإقفال",
      );
      assert(
        snapshot.partners!.length > 0,
        "PARTNERS_REQUIRED",
        "سجل نسب الشركاء قبل الإقفال",
      );
      const pending = await tx.expense.count({
        where: {
          status: "PENDING",
          date: { gte: snapshot.startsAt, lt: snapshot.endsAt },
        },
      });
      assert(
        !pending,
        "PENDING_EXPENSES",
        "راجع المصروفات المعلقة قبل الإقفال",
      );
      const row = await tx.accountingClose.create({
        data: {
          startsAt: snapshot.startsAt!,
          endsAt: snapshot.endsAt!,
          snapshot: json(snapshot),
          createdBy: actor(req).id,
        },
      });
      await audit(tx, actor(req).id, "ACCOUNTING_CLOSE", row.id, {
        year: p.year,
        quarter: p.quarter,
      });
      return {
        ...snapshot,
        closed: true,
        id: row.id,
        createdAt: row.createdAt,
      };
    });
    res.json({ data: result });
  } catch (e) {
    next(e);
  }
});
accounting.get("/accounting/batches", async (req, res, next) => {
  try {
    const paging = pagination(req.query);
    const [rows, total] = await db.$transaction([
      db.stockBatch.findMany({
        orderBy: [{ acquiredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        skip: paging.skip,
        take: paging.take,
      }),
      db.stockBatch.count(),
    ]);
    const ids = [...new Set(rows.map((r) => r.variantId))];
    const variants = await db.productVariant.findMany({
      where: { id: { in: ids } },
      include: { product: { select: { nameAr: true } } },
    });
    res.json(
      paginated(
        rows.map((r) => ({
          ...r,
          name: variants.find((v) => v.id === r.variantId)?.product.nameAr,
          sku: variants.find((v) => v.id === r.variantId)?.sku,
        })),
        total,
        paging,
      ),
    );
  } catch (e) {
    next(e);
  }
});
