import type { RequestHandler } from "express";
import ExcelJS from "exceljs";
import { z } from "zod";
import { variantOption } from "@az/shared";
import { db } from "../lib/db.js";
import { route } from "../utils/http.js";
import { buildProductWhere } from "./catalog.controller.js";
import { catalogPdf } from "./product-catalog-pdf.js";

// Catalog export of the product list: one row per variant. Cost is never
// exported: this is a customer-facing price list, not a financial report.
type Line = {
  name: string;
  nameEn: string;
  sku: string;
  barcode: string;
  category: string;
  size: string;
  color: string;
  price: number;
  stock: number;
  status: string;
  archived: boolean;
  imageId: string | null;
};
type Image = { mime: string; data: Buffer };

const labels = {
  image: "الصورة",
  name: "الاسم",
  nameEn: "الاسم (EN)",
  sku: "الكود",
  barcode: "الباركود",
  category: "القسم",
  size: "المقاس",
  color: "اللون",
  price: "سعر البيع",
  stock: "المخزون",
  status: "الحالة",
};
const imageIdOf = (url: string | null) =>
  url?.startsWith("/api/brand-assets/")
    ? url.slice("/api/brand-assets/".length)
    : null;
const money = (value: number) => value.toFixed(2);
const usable = (image?: Image) =>
  image && (image.mime === "image/png" || image.mime === "image/jpeg")
    ? image
    : undefined;

async function lines(query: Record<string, unknown>) {
  const products = await db.product.findMany({
    where: await buildProductWhere(query),
    include: {
      category: true,
      variants: {
        where: { active: true },
        include: { balances: true },
        orderBy: { sku: "asc" },
      },
    },
    orderBy: [{ nameAr: "asc" }, { id: "asc" }],
  });
  const out: Line[] = [];
  for (const p of products)
    for (const v of p.variants)
      out.push({
        name: p.nameAr,
        nameEn: p.nameEn ?? "",
        sku: v.sku,
        barcode: v.barcode,
        category: p.category.name,
        size: variantOption(v.options, "size"),
        color: variantOption(v.options, "color"),
        price: Number(v.price),
        stock: v.balances.reduce((sum, b) => sum + b.quantity, 0),
        status: p.status === "ARCHIVED" ? "مؤرشف" : "نشط",
        archived: p.status === "ARCHIVED",
        imageId: imageIdOf(p.imageUrl),
      });
  return out;
}
async function images(rows: Line[]) {
  const ids = [
    ...new Set(rows.map((r) => r.imageId).filter(Boolean)),
  ] as string[];
  const found = await db.brandAsset.findMany({
    where: { id: { in: ids } },
    select: { id: true, mime: true, data: true },
  });
  return new Map(
    found.map((a) => [a.id, { mime: a.mime, data: Buffer.from(a.data) }]),
  );
}
const stamp = () => new Date().toISOString().slice(0, 10);

function csv(rows: Line[], res: Parameters<RequestHandler>[1]) {
  const cols: (keyof typeof labels)[] = [
    "name",
    "nameEn",
    "sku",
    "barcode",
    "category",
    "size",
    "color",
    "price",
    "stock",
    "status",
  ];
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = [
    cols.map((c) => cell(labels[c])).join(","),
    ...rows.map((r) =>
      cols
        .map((c) => cell(c === "price" ? money(r.price) : r[c as keyof Line]))
        .join(","),
    ),
  ].join("\r\n");
  res.set({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename=az-products-${stamp()}.csv`,
    "Cache-Control": "no-store",
  });
  res.send("\uFEFF" + body);
}

async function xlsx(rows: Line[], res: Parameters<RequestHandler>[1]) {
  const imgs = await images(rows);
  const wb = new ExcelJS.Workbook();
  wb.creator = "A&Z Girls Fashion";
  const ws = wb.addWorksheet("المنتجات", {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
  });
  const cols: { key: keyof typeof labels; width: number }[] = [
    { key: "image", width: 14 },
    { key: "name", width: 30 },
    { key: "nameEn", width: 24 },
    { key: "sku", width: 18 },
    { key: "barcode", width: 18 },
    { key: "category", width: 16 },
    { key: "size", width: 10 },
    { key: "color", width: 12 },
    { key: "price", width: 16 },
    { key: "stock", width: 10 },
    { key: "status", width: 10 },
  ];
  ws.columns = cols.map((c) => ({
    header: labels[c.key],
    key: c.key,
    width: c.width,
  }));
  const head = ws.getRow(1);
  head.height = 26;
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FF111111" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFD4AF37" },
    };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  rows.forEach((r, i) => {
    const row = ws.addRow({ ...r, image: "", price: r.price });
    row.height = 56;
    row.eachCell((cell) => {
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
    });
    row.getCell("price").numFmt = "0.00";
    const img = usable(r.imageId ? imgs.get(r.imageId) : undefined);
    if (img) {
      const id = wb.addImage({
        buffer: img.data as unknown as ExcelJS.Buffer,
        extension: img.mime === "image/png" ? "png" : "jpeg",
      });
      ws.addImage(id, {
        tl: { col: 0.1, row: i + 1.1 },
        ext: { width: 56, height: 56 },
      });
    }
  });
  ws.autoFilter = { from: "A1", to: { row: 1, column: cols.length } };
  res.set({
    "Content-Type":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename=az-products-${stamp()}.xlsx`,
    "Cache-Control": "no-store",
  });
  await wb.xlsx.write(res);
  res.end();
}

export const handleGetProductsExport: RequestHandler = route(
  async (req, res) => {
    const format = z.enum(["pdf", "xlsx", "csv"]).parse(req.query.format);
    const rows = await lines(req.query);
    if (format === "csv") return csv(rows, res);
    if (format === "xlsx") return xlsx(rows, res);
    // Customer-facing catalog: available items only - no archived products,
    // no out-of-stock variants, and the card layout never shows quantities.
    const available = rows.filter((r) => !r.archived && r.stock > 0);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename=az-catalog-${stamp()}.pdf`,
      "Cache-Control": "no-store",
    });
    return catalogPdf(available, await images(rows), res);
  },
);
