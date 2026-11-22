import type { RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { checkoutSchema } from "@az/shared";
import { db, assert, audit, json } from "../lib/db.js";
import { actor } from "../middleware/auth.js";
import { checkout, once, refund, returnSchema } from "../services/operations.js";
import { route, uuid, page, hasCosts } from "../utils/http.js";

export const handlePostSales: RequestHandler = route(async (req, res) => {
    const input = checkoutSchema.parse(req.body);
    const result = await once(
      actor(req),
      req.get("Idempotency-Key"),
      "checkout",
      input,
      (tx) => checkout(tx, actor(req), input),
    );
    res.status(201).json({ data: safeSale(result, hasCosts(req)) });
  });

function safeSale(s: any, costs: boolean) {
  const out = json(s);
  function scrub(v: any) {
    if (!v || typeof v !== "object") return;
    for (const key of Object.keys(v)) {
      if (
        key === "passwordHash" ||
        (!costs && ["unitCost", "cost", "inventoryCost"].includes(key))
      )
        delete v[key];
      else scrub(v[key]);
    }
  }
  scrub(out);
  return out;
}

export const handleGetSales: RequestHandler = route(async (req, res) => {
    const where: Prisma.SaleWhereInput = actor(req).permissions.includes(
      "sales.view_all",
    )
      ? {}
      : { userId: actor(req).id };
    const searchVal = (req.query.barcode || req.query.number || req.query.search)?.toString().trim();
    if (searchVal) {
      const value = z.string().max(64).parse(searchVal);
      const orConditions: Prisma.SaleWhereInput[] = [
        { receiptNumber: { contains: value, mode: "insensitive" } },
        { items: { some: { barcode: { contains: value, mode: "insensitive" } } } },
        { items: { some: { sku: { contains: value, mode: "insensitive" } } } },
      ];
      if (/^\d{1,18}$/.test(value)) {
        try {
          orConditions.push({ number: BigInt(value) });
        } catch {
          // Values outside JavaScript's safe BigInt parsing range are still searched by text.
        }
      }
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        { OR: orConditions },
      ];
    }
    const [data, total] = await Promise.all([
      db.sale.findMany({
        where,
        include: {
          items: true,
          payments: true,
          user: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        ...page(req.query),
      }),
      db.sale.count({ where }),
    ]);
    res.json({ data: data.map((s) => safeSale(s, hasCosts(req))), total });
  });

export const handleGetSalesById: RequestHandler = route(async (req, res) => {
    const s = await db.sale.findUnique({
      where: { id: uuid(req.params.id) },
      include: {
        items: true,
        payments: true,
        user: { select: { name: true } },
        customer: { select: { name: true, phone: true, address: true } },
        returns: { include: { items: true } },
      },
    });
    assert(s, "NOT_FOUND", "Sale not found", 404);
    assert(
      s.userId === actor(req).id ||
        actor(req).permissions.includes("sales.view_all"),
      "FORBIDDEN",
      "Access denied",
      403,
    );
    const out = safeSale(s, hasCosts(req));
    if (!hasCosts(req))
      for (const r of out.returns) for (const i of r.items) delete i.cost;
    res.json({ data: out });
  });

export const handlePostSalesByIdReturns: RequestHandler = route(async (req, res) => {
    const saleId = uuid(req.params.id),
      input = returnSchema.parse(req.body);
    res.json({
      data: safeSale(
        await once(
          actor(req),
          req.get("Idempotency-Key"),
          `refund:${saleId}`,
          input,
          (tx) => refund(tx, actor(req), saleId, input),
        ),
        hasCosts(req),
      ),
    });
  });

export const handlePostSalesByIdExchanges: RequestHandler = route(async (req, res) => {
    const saleId = uuid(req.params.id),
      input = z
        .object({ returned: returnSchema, replacement: checkoutSchema })
        .parse(req.body);
    const result = (await once(
      actor(req),
      req.get("Idempotency-Key"),
      `exchange:${saleId}`,
      input,
      async (tx) => {
        const returned = await refund(tx, actor(req), saleId, input.returned);
        const replacement = await checkout(tx, actor(req), input.replacement);
        await audit(tx, actor(req).id, "EXCHANGE", replacement.id, {
          returnId: returned.id,
        });
        return { returned, replacement };
      },
    )) as any;
    res.json({
      data: {
        returned: safeSale(result.returned, hasCosts(req)),
        replacement: safeSale(result.replacement, hasCosts(req)),
      },
    });
  });
