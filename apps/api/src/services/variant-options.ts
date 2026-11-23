import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../lib/db.js";
import { hasCosts } from "../utils/http.js";
// Read-only, bounded picker endpoint. Normalize on both sides in PostgreSQL so
// Arabic variants and searches beyond the first page are matched consistently.
const normalized = (value: Prisma.Sql) => Prisma.sql`lower(translate(
  regexp_replace(normalize(${value}, NFKD), '[ـً-ٰٟۖ-ۭ]', '', 'g'),
  'أإآٱةى٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', 'ااااهي01234567890123456789'))`;

export async function variantOptions(req: import("express").Request) {
  const q = z.string().trim().max(200).default("").parse(req.query.q);
  const offset = z.coerce
    .number()
    .int()
    .min(0)
    .default(0)
    .parse(req.query.offset);
  const selected = z.string().uuid().optional().parse(req.query.selected);
  const source = Prisma.sql`concat_ws(' ', p."nameAr", p."nameEn", p.sku, v.sku, v.barcode, v.options::text)`;
  const terms = q.split(/\s+/).filter(Boolean);
  const filters = terms.map(
    (term) =>
      Prisma.sql`position(${normalized(Prisma.sql`${term}::text`)} in ${normalized(source)}) > 0`,
  );
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT v.id FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId"
    WHERE p.status <> 'ARCHIVED'
    ${filters.length ? Prisma.sql`AND ${Prisma.join(filters, " AND ")}` : Prisma.empty}
    ORDER BY p."createdAt" DESC, p.id, v.id LIMIT 51 OFFSET ${offset}`);
  const ids = rows.slice(0, 50).map((row) => row.id);
  const variants = await db.productVariant.findMany({
    where: { id: { in: [...ids, ...(selected ? [selected] : [])] } },
    select: {
      id: true,
      sku: true,
      barcode: true,
      options: true,
      cost: hasCosts(req),
      price: true,
      active: true,
      balances: { select: { locationId: true, quantity: true } },
      product: { select: { nameAr: true } },
    },
  });
  const byId = new Map(
    variants.map((variant) => [
      variant.id,
      {
        ...variant,
        productNameAr: variant.product.nameAr,
        name: variant.product.nameAr,
      },
    ]),
  );
  return {
    data: ids.map((id) => byId.get(id)),
    hasMore: rows.length > 50,
    selected: selected ? (byId.get(selected) ?? null) : null,
  };
                 }
