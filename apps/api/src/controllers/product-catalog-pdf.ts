import PDFDocument from "pdfkit";
import { fileURLToPath } from "node:url";
import { runsFor } from "../utils/report-pdf.js";

// Customer-facing catalog: a cover page, then a card grid (3 per row).
// Each card shows the product image, name, size/color and selling price.
// Never shows stock quantities, cost, supplier or internal notes.
//
// All text is positioned by BASELINE, with each run's own font ascent,
// because the Amiri Arabic font is far taller than Helvetica at the same
// point size: drawing mixed runs at one top y misaligns them, and spacing
// lines by point size alone makes Arabic lines overlap.
export type CatalogLine = {
  name: string;
  sku: string;
  size: string;
  color: string;
  price: number;
  imageId: string | null;
};
export type CatalogImage = { mime: string; data: Buffer };

const asset = (name: string) =>
  fileURLToPath(new URL(`../../assets/${name}`, import.meta.url));

const BLACK = "#111111";
const GOLD = "#D4AF37";
const GOLD_DARK = "#7a5c00";
const GOLD_PALE = "#faf6e9";
const INK = "#171717";
const GRAY = "#666666";
const BORDER = "#e8dcc0";

const money = (value: number) =>
  value
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1");

export async function catalogPdf(
  rows: CatalogLine[],
  images: Map<string, CatalogImage>,
  sink: NodeJS.WritableStream,
) {
  const pdf = new PDFDocument({
    size: "A4",
    layout: "portrait",
    margin: 0,
    bufferPages: true,
    info: {
      Title: "A&Z Girls Fashion - Product Catalog",
      Author: "A&Z Girls Fashion",
    },
  });
  const done = new Promise<void>((ok, bad) => {
    sink.on("finish", ok);
    sink.on("error", bad);
    pdf.on("error", bad);
  });
  pdf.pipe(sink);
  pdf.registerFont("Arabic", asset("Amiri-Regular.ttf"));
  const logo = asset("az-logo.jpg");
  const W = pdf.page.width,
    H = pdf.page.height;

  const fontFor = (v: string) =>
    /^[\x20-\x7e]*$/.test(v) ? "Helvetica" : "Arabic";
  // pdfkit keeps the active fontkit font on a field its type definitions
  // hide; read it through a narrow structural type for ascent/descent.
  const activeFont = () =>
    (
      pdf as unknown as {
        _font: { ascender: number; descender: number; unitsPerEm?: number };
      }
    )._font;
  const wid = (v: string, size: number) =>
    pdf.font(fontFor(v)).fontSize(size).widthOfString(v, { features: [] });
  // Vertical metrics of the tallest run of a string at a size.
  const metrics = (v: string, size: number) => {
    let ascent = 0,
      descent = 0,
      line = 0;
    for (const r of runsFor(v)) {
      pdf.font(fontFor(r.text)).fontSize(size);
      const fo = activeFont();
      const upm = fo.unitsPerEm || 1000;
      ascent = Math.max(ascent, (fo.ascender / upm) * size);
      descent = Math.max(descent, (-fo.descender / upm) * size);
      line = Math.max(line, pdf.currentLineHeight(true));
    }
    return { ascent, descent, line };
  };
  const measure = (v: string, size: number) =>
    runsFor(v).reduce((s, r) => s + wid(r.text, size), 0);
  // baselineY is the shared baseline for every run of the string.
  const draw = (
    v: string,
    x: number,
    baselineY: number,
    w: number,
    size: number,
    color = INK,
    align: "right" | "center" = "center",
  ) => {
    pdf.fillColor(color);
    const runs = runsFor(v);
    const total = runs.reduce((s, r) => s + wid(r.text, size), 0);
    let cur = align === "center" ? x + (w - total) / 2 : x + w - total;
    for (const r of runs) {
      pdf.font(fontFor(r.text)).fontSize(size);
      const fo = activeFont();
      const upm = fo.unitsPerEm || 1000;
      const ascent = (fo.ascender / upm) * size;
      pdf.text(r.text, cur, baselineY - ascent, {
        lineBreak: false,
        features: [],
      });
      cur += wid(r.text, size);
    }
  };
  const wrap = (v: string, w: number, size: number, max: number): string[] => {
    const out: string[] = [];
    let line = "";
    for (const word of v.split(/\s+/).filter(Boolean)) {
      const c = line ? `${line} ${word}` : word;
      if (measure(c, size) <= w) line = c;
      else {
        if (line) out.push(line);
        line = word;
      }
      if (out.length === max) break;
    }
    if (line && out.length < max) out.push(line);
    else if (line && out.length === max) out[max - 1] = `${out[max - 1]!}…`;
    return out;
  };

  const date = new Date().toISOString().slice(0, 10);

  // Cover page.
  pdf.rect(0, 0, W, H).fill(BLACK);
  const ruleY = H * 0.6;
  try {
    pdf.image(logo, (W - 300) / 2, H * 0.16, { width: 300 });
  } catch {
    /* logo unreadable: cover still works without it */
  }
  pdf.rect(0, ruleY, W, 3).fill(GOLD);
  const mTitle = metrics("كتالوج المنتجات", 34);
  const mBrand = metrics("A&Z Girls Fashion", 15);
  const mDate = metrics(date, 11);
  const titleBase = ruleY + 24 + mTitle.ascent;
  draw("كتالوج المنتجات", 0, titleBase, W, 34, GOLD);
  const brandBase = titleBase + mTitle.descent + 16 + mBrand.ascent;
  draw("A&Z Girls Fashion", 0, brandBase, W, 15, "#dddddd");
  draw(
    date,
    0,
    brandBase + mBrand.descent + 12 + mDate.ascent,
    W,
    11,
    "#999999",
  );

  const M = 36;
  const GAP = 14;
  const COLS = 3;
  const ROWS = 3;
  const top = 84;
  const bottom = H - 34;
  const cardW = (W - M * 2 - GAP * (COLS - 1)) / COLS;
  const cardH = (bottom - top - GAP * (ROWS - 1)) / ROWS;

  // Card text sizes and the vertical blocks they occupy.
  const NAME = 12,
    META = 9.5,
    PRICE = 13;
  const mName = metrics("ب", NAME);
  const mMeta = metrics("ب", META);
  const mPrice = metrics("0ب", PRICE);
  const nameBlock = mName.ascent + mName.line + mName.descent; // up to 2 lines
  const metaBlock = mMeta.ascent + mMeta.descent;
  const priceBlock = mPrice.ascent + mPrice.descent;
  const imgH = cardH - 8 - 4 - nameBlock - 4 - metaBlock - 6 - priceBlock - 8;

  const header = () => {
    pdf.rect(0, 0, W, 56).fill(BLACK);
    pdf.rect(0, 56, W, 3).fill(GOLD);
    try {
      pdf.image(logo, M, 8, { height: 40 });
    } catch {
      /* logo unreadable: header still works without it */
    }
    const mh = metrics("كتالوج المنتجات", 17);
    const ms = metrics("A&Z", 9);
    const titleY = 7 + mh.ascent;
    draw("كتالوج المنتجات", M, titleY, W - M * 2, 17, GOLD, "right");
    draw(
      `A&Z Girls Fashion  |  ${date}`,
      M,
      titleY + mh.descent + 3 + ms.ascent,
      W - M * 2,
      9,
      "#bbbbbb",
      "right",
    );
  };

  const placeholder = (x: number, y: number, w: number, h: number) => {
    pdf.roundedRect(x, y, w, h, 6).fill(GOLD_PALE);
    const s = Math.min(30, h * 0.32);
    pdf.font("Helvetica-Bold").fontSize(s);
    const fo = activeFont();
    const upm = fo.unitsPerEm || 1000;
    const glyphH = ((fo.ascender - fo.descender) / upm) * s;
    const wText = pdf.widthOfString("A&Z");
    pdf.fillColor(GOLD);
    pdf.text("A&Z", x + (w - wText) / 2, y + (h - glyphH) / 2, {
      lineBreak: false,
    });
  };

  const card = (r: CatalogLine, x: number, y: number) => {
    pdf.roundedRect(x, y, cardW, cardH, 8).fillAndStroke("#ffffff", BORDER);
    const img = r.imageId ? images.get(r.imageId) : undefined;
    const ok = img && (img.mime === "image/png" || img.mime === "image/jpeg");
    if (ok) {
      try {
        pdf.image(img.data, x + 8, y + 8, {
          fit: [cardW - 16, imgH],
          align: "center",
          valign: "center",
        });
      } catch {
        placeholder(x + 8, y + 8, cardW - 16, imgH);
      }
    } else {
      placeholder(x + 8, y + 8, cardW - 16, imgH);
    }
    let baseline = y + 8 + imgH + 4 + mName.ascent;
    const nameLines = wrap(r.name, cardW - 16, NAME, 2);
    for (const l of nameLines) {
      draw(l, x + 8, baseline, cardW - 16, NAME, INK);
      baseline += mName.line;
    }
    // Meta sits under the last name line; price is pinned to the card bottom.
    // After the loop, `baseline` is one name line-height below the last line.
    const meta = [r.size, r.color].filter(Boolean).join("  |  ");
    if (meta) {
      const lastNameBase = baseline - mName.line;
      draw(
        meta,
        x + 8,
        lastNameBase + mName.descent + 4 + mMeta.ascent,
        cardW - 16,
        META,
        GRAY,
      );
    }
    const priceBase = y + cardH - 8 - mPrice.descent;
    draw(
      `${money(r.price)} ج.م`,
      x + 8,
      priceBase,
      cardW - 16,
      PRICE,
      GOLD_DARK,
    );
    draw(r.sku, x + 8, priceBase, cardW - 16, 7.5, "#bbbbbb", "right");
  };

  const usable = rows;
  if (usable.length === 0) {
    pdf.addPage();
    header();
    const me = metrics("لا توجد منتجات متاحة حاليا", 18);
    draw(
      "لا توجد منتجات متاحة حاليا",
      M,
      H / 2 - me.descent,
      W - M * 2,
      18,
      GRAY,
    );
  }
  for (let i = 0; i < usable.length; i++) {
    const slot = i % (COLS * ROWS);
    if (slot === 0) {
      pdf.addPage();
      header();
    }
    const col = Math.floor(slot / ROWS); // fill column-first so Arabic reads right column first
    const row = slot % ROWS;
    const x = W - M - cardW - col * (cardW + GAP);
    const y = top + row * (cardH + GAP);
    card(usable[i]!, x, y);
  }

  const range = pdf.bufferedPageRange();
  const mf = metrics("0", 9);
  for (let i = 1; i < range.count; i++) {
    pdf.switchToPage(i);
    draw(
      `${i} / ${range.count - 1}`,
      M,
      H - 10 - mf.descent,
      W - M * 2,
      9,
      GRAY,
      "center",
    );
  }
  pdf.end();
  await done;
}
