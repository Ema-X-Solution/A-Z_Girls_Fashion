import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
globalThis.DOMMatrix ??= DOMMatrix;
globalThis.ImageData ??= ImageData;
globalThis.Path2D ??= Path2D;
const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
const input = process.argv[2],
  output = process.argv[3];
if (!input || !output)
  throw new Error("Usage: node scripts/render-pdf.mjs input.pdf output.png");
const standardFontDataUrl = fileURLToPath(
  new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url),
).replaceAll("\\", "/");
const pdf = await getDocument({
  data: new Uint8Array(readFileSync(resolve(input))),
  standardFontDataUrl,
  disableFontFace: true,
  useSystemFonts: true,
}).promise;
const page = await pdf.getPage(1),
  viewport = page.getViewport({ scale: 2 }),
  canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport })
  .promise;
mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(resolve(output), canvas.toBuffer("image/png"));
const text = (await page.getTextContent()).items
  .map((i) => i.str ?? "")
  .join(" ");
console.log(
  JSON.stringify({
    pages: pdf.numPages,
    width: page.view[2],
    height: page.view[3],
    text,
  }),
);
await pdf.cleanup();
