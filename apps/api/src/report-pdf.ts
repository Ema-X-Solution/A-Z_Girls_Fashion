import PDFDocument from "pdfkit";
import bidiFactory from "bidi-js";
import { fileURLToPath } from "node:url";
import type { Response } from "express";
const bidi = bidiFactory();
function runsFor(text: string) {
  const levels = bidi.getEmbeddingLevels(text, "rtl").levels as Uint8Array;
  const runs: { text: string; level: number }[] = [];
  for (let i = 0; i < text.length; i++) {
    const level = levels[i]!;
    const previous = runs.at(-1);
    if (previous?.level === level) previous.text += text[i];
    else runs.push({ text: text[i]!, level });
  }
  const max = Math.max(...runs.map((r) => r.level));
  const odds = runs.filter((r) => r.level % 2).map((r) => r.level);
  const min = odds.length ? Math.min(...odds) : max + 1;
  for (let level = max; level >= min; level--) {
    for (let i = 0; i < runs.length;) {
      if (runs[i]!.level < level) {
        i++;
        continue;
      }
      let end = i;
      while (end < runs.length && runs[end]!.level >= level) end++;
      runs.splice(i, end - i, ...runs.slice(i, end).reverse());
      i = end;
    }
  }
  return runs;
}
export async function reportPdf(
  res: Response,
  title: string,
  columns: { key: string; label: string }[],
  rows: Record<string, unknown>[],
  period: string,
) {
  const pdf = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 32,
    bufferPages: true,
    info: { Title: title, Author: "A&Z Girls Fashion" },
  });
  const done = new Promise<void>((resolve, reject) => {
    res.on("finish", resolve);
    res.on("error", reject);
    pdf.on("error", reject);
  });
  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": "attachment; filename=az-report.pdf",
    "Cache-Control": "no-store",
  });
  pdf.pipe(res);
  pdf
    .registerFont(
      "Arabic",
      fileURLToPath(new URL("../assets/Amiri-Regular.ttf", import.meta.url)),
    )
    .font("Arabic");
  const width = pdf.page.width - 64,
    cw = width / columns.length,
    lineHeight = 17;
  let y = 0;
  const measure = (value: string) =>
    runsFor(value).reduce(
      (sum, r) => sum + pdf.widthOfString(r.text, { features: [] }),
      0,
    );
  const text = (value: string, x: number, at: number, w: number, size = 11) => {
    pdf.fontSize(size).fillColor("#171717");
    const runs = runsFor(value);
    const widths = runs.map((r) => pdf.widthOfString(r.text, { features: [] }));
    let cursor = x + w - widths.reduce((s, v) => s + v, 0);
    runs.forEach((r, i) => {
      pdf.text(r.text, cursor, at, {
        width: widths[i]! + 1,
        lineBreak: false,
        features: [],
      });
      cursor += widths[i]!;
    });
  };
  function heading() {
    text("A&Z Girls Fashion", 32, 24, width, 16);
    text(title, 32, 51, width, 15);
    text(period, 32, 76, width, 10);
    y = 105;
    pdf.fontSize(11);
    const labels = columns.map((c) => wrap(c.label));
    const height = Math.max(...labels.map((l) => l.length)) * lineHeight + 8;
    pdf.rect(32, y, width, height).fill("#eeeeee");
    labels.forEach((lines, i) =>
      lines.forEach((line, n) =>
        text(
          line,
          32 + width - (i + 1) * cw + 5,
          y + 3 + n * lineHeight,
          cw - 10,
          11,
        ),
      ),
    );
    y += height + 4;
  }
  function wrap(value: unknown) {
    const words = String(value ?? "—").split(/\s+/),
      lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = (line ? line + " " : "") + word;
      if (measure(candidate) <= cw - 12) {
        line = candidate;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      for (const char of word) {
        if (line && measure(line + char) > cw - 12) {
          lines.push(line);
          line = char;
        } else line += char;
      }
    }
    lines.push(line);
    return lines;
  }
  heading();
  pdf.fontSize(11);
  for (const row of rows) {
    const cells = columns.map((c) => wrap(row[c.key]));
    let offset = 0;
    const count = Math.max(...cells.map((c) => c.length));
    while (offset < count) {
      if (y + lineHeight > pdf.page.height - 42) {
        pdf.addPage();
        heading();
      }
      const fit = Math.min(
        count - offset,
        Math.floor((pdf.page.height - 42 - y) / lineHeight),
      );
      for (let i = 0; i < columns.length; i++) {
        const x = 32 + width - (i + 1) * cw;
        for (let line = 0; line < fit; line++) {
          if (cells[i]![offset + line] !== undefined)
            text(
              cells[i]![offset + line]!,
              x + 5,
              y + line * lineHeight,
              cw - 10,
            );
        }
      }
      y += fit * lineHeight + 6;
      pdf
        .strokeColor("#dddddd")
        .moveTo(32, y)
        .lineTo(32 + width, y)
        .stroke();
      y += 4;
      offset += fit;
    }
  }
  const pages = pdf.bufferedPageRange();
  for (let n = 0; n < pages.count; n++) {
    pdf.switchToPage(n);
    const bottom = pdf.page.margins.bottom;
    pdf.page.margins.bottom = 0;
    text(`${n + 1} / ${pages.count}`, 32, pdf.page.height - 27, width, 9);
    pdf.page.margins.bottom = bottom;
  }
  pdf.end();
  await done;
}
