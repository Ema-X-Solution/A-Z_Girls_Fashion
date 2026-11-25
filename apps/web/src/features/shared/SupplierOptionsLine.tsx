import { formatDigits } from "../../i18n";

const colorKey = /^(color|colour|اللون)$/i;

// Same line the printed barcode label writes: size | supplier code | color.
// Returns null when there is nothing to write.
export function SupplierOptionsLine({
  supplierCode,
  options,
}: {
  supplierCode?: string | null;
  options: Record<string, string>;
}) {
  const entries = Object.entries(options).filter(([, v]) => v.trim());
  const pick = (isColor: boolean) =>
    entries
      .filter(([k]) => colorKey.test(k.trim()) === isColor)
      .map(([, v]) => formatDigits(v.trim()))
      .join(" / ");
  const size = pick(false),
    color = pick(true),
    supplier = supplierCode?.trim() ?? "";
  if (!size && !color && !supplier) return null;
  return (
    <div className="card-options-line" dir="ltr">
      <span className="card-size" dir="auto">{size}</span>
      <span className="card-supplier">{supplier}</span>
      <span className="card-color" dir="auto">{color}</span>
    </div>
  );
}
