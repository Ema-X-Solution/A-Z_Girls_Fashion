import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Use a child process: a synchronous renderer loop cannot be stopped by a
// Promise or Vitest timeout in the same event loop.
const render = `
  import { PassThrough } from "node:stream";
  import { reportPdf } from "./apps/api/src/utils/report-pdf.ts";
  const res = new PassThrough();
  res.set = () => {};
  const chunks = [];
  res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  await reportPdf(
    res,
    "أرصدة الموردين",
    [
      { key: "supplier", label: "المورد" },
      { key: "phone", label: "الهاتف" },
      { key: "notes", label: "" },
      { key: "balance", label: "الرصيد" },
    ],
    [
      { supplier: "TEST Supplier", phone: "", notes: "", balance: "70" },
      { supplier: "", phone: "01000000000", notes: "\\u200e\\u200f\\u061c", balance: "-15.5" },
      { supplier: "   ", phone: null, notes: undefined, balance: 0 },
    ],
    "",
  );
  process.stdout.write(Buffer.concat(chunks));
`;

describe("report PDF empty cells", () => {
  it("completes for empty, whitespace and direction-mark-only cells", async () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", render],
      { cwd: process.cwd(), timeout: 15000, maxBuffer: 5 * 1024 * 1024 },
    );
    expect(result.error, result.stderr.toString()).toBeUndefined();
    expect(result.status, result.stderr.toString()).toBe(0);
    expect(result.stdout.subarray(0, 5).toString()).toBe("%PDF-");
    const loading = getDocument({
      data: new Uint8Array(result.stdout),
      useSystemFonts: true,
    });
    const pdf = await loading.promise;
    try {
      expect(pdf.numPages).toBe(1);
      const page = await pdf.getPage(1);
      const content = await page.getTextContent();
      const text = content.items
        .flatMap((item) => ("str" in item ? [item.str] : []))
        .join(" ");
      expect(text).toContain("TEST Supplier");
      expect(text).toContain("70");
      expect(text).toContain("-15.5");
      expect(text).toContain("01000000000");
    } finally {
      await loading.destroy();
    }
  });
});
