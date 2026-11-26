import type { RequestHandler } from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { variantOption } from "@az/shared";
import { db } from "../lib/db.js";
import { route } from "../utils/http.js";
import { runsFor } from "../utils/report-pdf.js";
import { buildProductWhere } from "./catalog.controller.js";

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
const asset = (name: string) =>
  fileURLToPath(new URL(`../../assets/${name}`, import.meta.url));
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

async function pdfOut(rows: Line[], res: Parameters<RequestHandler>[1]) {
  const imgs = await images(rows);
  const pdf = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 32,
    bufferPages: true,
    info: {
      Title: "A&Z Girls Fashion - Product Catalog",
      Author: "A&Z Girls Fashion",
    },
  });
  const done = new Promise<void>((ok, bad) => {
    res.on("finish", ok);
    res.on("error", bad);
    pdf.on("error", bad);
  });
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename=az-products-${stamp()}.pdf`,
    "Cache-Control": "no-store",
  });
  pdf.pipe(res);
  pdf.registerFont("Arabic", asset("Amiri-Regular.ttf"));
  const logo = asset("az-logo.jpg");
  const W = pdf.page.width,
    H = pdf.page.height,
    M = 32,
    tableW = W - M * 2;
  // Columns laid out right to left (Arabic). Fractions of the table width.
  const cols: { key: keyof typeof labels; w: number }[] = [
    { key: "image", w: 0.08 },
    { key: "name", w: 0.22 },
    { key: "sku", w: 0.13 },
    { key: "size", w: 0.08 },
    { key: "color", w: 0.1 },
    { key: "category", w: 0.14 },
    { key: "price", w: 0.13 },
    { key: "stock", w: 0.1 },
  ];
  const widths = cols.map((c) => c.w * tableW);
  const xs = widths.map(
    (_, i) => M + tableW - widths.slice(0, i + 1).reduce((a, b) => a + b, 0),
  );
  const fontFor = (v: string) =>
    /^[\x20-\x7e]*$/.test(v) ? "Helvetica" : "Arabic";
  const wid = (v: string, size: number) =>
    pdf.font(fontFor(v)).fontSize(size).widthOfString(v, { features: [] });
  const measure = (v: string, size: number) =>
    runsFor(v).reduce((s, r) => s + wid(r.text, size), 0);
  const draw = (
    v: string,
    x: number,
    y: number,
    w: number,
    size: number,
    color = "#171717",
    align: "right" | "center" = "center",
  ) => {
    pdf.fillColor(color);
    const runs = runsFor(v);
    const total = runs.reduce((s, r) => s + wid(r.text, size), 0);
    let cur = align === "center" ? x + (w - total) / 2 : x + w - total;
    for (const r of runs) {
      pdf
        .font(fontFor(r.text))
        .fontSize(size)
        .text(r.text, cur, y, { lineBreak: false, features: [] });
      cur += wid(r.text, size);
    }
  };
  const wrap = (v: string, w: number, size: number): string[] => {
    const out: string[] = [];
    let line = "";
    for (const word of v.split(/\s+/)) {
      const c = line ? `${line} ${word}` : word;
      if (measure(c, size) <= w) line = c;
      else {
        if (line) out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
    return out.slice(0, 3);
  };
  const date = new Date().toISOString().slice(0, 10);
  let y = 0;
  const header = () => {
    pdf.rect(0, 0, W, 78).fill("#111111");
    pdf.rect(0, 78, W, 3).fill("#D4AF37");
    pdf.image(logo, M, 10, { height: 58 });
    draw("كتالوج المنتجات", M, 10, tableW, 22, "#D4AF37", "right");
    draw(
      `A&Z Girls Fashion  |  ${date}`,
      M,
      52,
      tableW,
      11,
      "#dddddd",
      "right",
    );
    y = 94;
    pdf.rect(M, y, tableW, 24).fill("#D4AF37");
    cols.forEach((c, i) =>
      draw(labels[c.key], xs[i]!, y + 5, widths[i]!, 12, "#111111"),
    );
    y += 28;
  };
  header();
  let n = 0;
  for (const r of rows) {
    const rowH = 46;
    if (y + rowH > H - 40) {
      pdf.addPage();
      header();
    }
    if (n++ % 2 === 0) pdf.rect(M, y - 2, tableW, rowH).fill("#faf6e9");
    const img = usable(r.imageId ? imgs.get(r.imageId) : undefined);
    if (img) {
      try {
        pdf.image(img.data, xs[0]! + (widths[0]! - 40) / 2, y + 1, {
          fit: [40, 40],
          align: "center",
          valign: "center",
        });
      } catch {
        /* unreadable image: leave the cell empty */
      }
    }
    const nameLines = wrap(r.name, widths[1]! - 10, 11);
    nameLines.forEach((l, k) =>
      draw(
        l,
        xs[1]!,
        y + 10 - (nameLines.length - 1) * 7 + k * 14,
        widths[1]!,
        11,
        "#171717",
        "right",
      ),
    );
    const mid = y + 10;
    draw(r.sku, xs[2]!, mid, widths[2]!, 9);
    draw(r.size || "-", xs[3]!, mid, widths[3]!, 11);
    draw(r.color || "-", xs[4]!, mid, widths[4]!, 11);
    draw(r.category, xs[5]!, mid, widths[5]!, 10);
    draw(`EGP ${money(r.price)}`, xs[6]!, mid, widths[6]!, 11, "#7a5c00");
    draw(
      String(r.stock),
      xs[7]!,
      mid,
      widths[7]!,
      11,
      r.stock <= 0 ? "#b00020" : "#171717",
    );
    pdf
      .moveTo(M, y + rowH - 2)
      .lineTo(M + tableW, y + rowH - 2)
      .lineWidth(0.4)
      .stroke("#dddddd");
    y += rowH;
  }
  const range = pdf.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    pdf.switchToPage(i);
    draw(
      `${i + 1} / ${range.count}`,
      M,
      H - 26,
      tableW,
      9,
      "#666666",
      "center",
    );
  }
  pdf.end();
  await done;
}

export const handleGetProductsExport: RequestHandler = route(
  async (req, res) => {
    const format = z.enum(["pdf", "xlsx", "csv"]).parse(req.query.format);
    const rows = await lines(req.query);
    if (format === "csv") return csv(rows, res);
    if (format === "xlsx") return xlsx(rows, res);
    return pdfOut(rows, res);
  },
);
