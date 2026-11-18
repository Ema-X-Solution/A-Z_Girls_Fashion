import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Printer, Search, ScanBarcode, RefreshCw } from "lucide-react";
import JsBarcode from "jsbarcode";
import { api, post } from "../../api";
import { Button } from "../../components/ui/button";
import { formatMoney } from "../../i18n";
import { useDebouncedSearch } from "../../hooks/useDebouncedSearch";

type Variant = {
  id: string;
  sku: string;
  barcode: string;
  price: string;
  active: boolean;
  options: Record<string, string>;
  balances?: { quantity: number }[];
};
type Product = { id: string; nameAr: string; variants: Variant[] };
type Line = {
  variantId: string;
  name: string;
  sku: string;
  barcode: string;
  price: string;
  options: Record<string, string>;
  quantity: number;
};
type Job = { storeName: string; items: Line[] };
const presets: Record<string, { width: number; height: number }> = {
  "40x30": { width: 40, height: 30 },
  "50x30": { width: 50, height: 30 },
  "60x40": { width: 60, height: 40 },
};
function Control({
  label,
  children,
}: {
  label: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}
function Label({
  line,
  storeName,
  price,
}: {
  line: Line;
  storeName: string;
  price: boolean;
}) {
  return (
    <article className="retail-label" data-barcode={line.barcode}>
      <strong className="label-store">{storeName}</strong>
      <div className="label-name">{line.name}</div>
      <div className="label-options">
        {Object.values(line.options).join(" / ") || line.sku}
        {price && <b>{formatMoney(line.price)}</b>}
      </div>
      <svg
        aria-label={`باركود ${line.barcode}`}
        role="img"
        ref={(svg) => {
          if (!svg) return;
          JsBarcode(svg, line.barcode, {
            format: "CODE128",
            height: 50,
            width: 2,
            displayValue: false,
            margin: 0,
            marginLeft: 20,
            marginRight: 20,
            background: "#fff",
            lineColor: "#000",
          });
          const w = svg.getAttribute("width"),
            h = svg.getAttribute("height");
          svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
          svg.removeAttribute("width");
          svg.removeAttribute("height");
          svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        }}
      />
      <div className="label-number" dir="ltr">
        {line.barcode}
      </div>
    </article>
  );
}

export function BarcodeLabels({ product }: { product?: Product }) {
  const [params] = useSearchParams(),
    receiptId = product ? null : params.get("receiptId"),
    [loadedReceipt, setLoadedReceipt] = useState<string | null>(null);
  const [q, setQ] = useState(""),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<
      Record<string, { variant: Variant; name: string; quantity: number }>
    >(() =>
      Object.fromEntries(
        (product?.variants.filter((v) => v.active) ?? []).map((v) => [
          v.id,
          { variant: v, name: product!.nameAr, quantity: 1 },
        ]),
      ),
    ),
    [preset, setPreset] = useState("50x30"),
    [customWidth, setCustomWidth] = useState(50),
    [customHeight, setCustomHeight] = useState(30),
    [paper, setPaper] = useState("thermal"),
    [showPrice, setShowPrice] = useState(true),
    [job, setJob] = useState<Job | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const { debounced: debouncedQ, searchPending } = useDebouncedSearch(q);
  const query = useQuery({
    queryKey: ["barcode-catalog", debouncedQ, offset],
    queryFn: ({ signal }) =>
      api<{ data: Product[]; total: number }>(
        `/products?q=${encodeURIComponent(debouncedQ)}&offset=${offset}`,
        { signal },
      ),
    enabled: !product && !receiptId && !searchPending,
  });
  const receipt = useQuery({
    queryKey: ["barcode-receipt", receiptId],
    queryFn: ({ signal }) =>
      api<{
        data: { products: Product[]; quantities: Record<string, number> };
      }>(`/barcodes/receipts/${receiptId}/items`, { signal }),
    enabled: !!receiptId,
  });
  useEffect(() => {
    if (!receiptId || !receipt.data || loadedReceipt === receiptId) return;
    setSelected(
      Object.fromEntries(
        receipt.data.data.products.flatMap((p) =>
          p.variants.map((v) => [
            v.id,
            {
              variant: v,
              name: p.nameAr,
              quantity: receipt.data.data.quantities[v.id] ?? 1,
            },
          ]),
        ),
      ),
    );
    setJob(null);
    setLoadedReceipt(receiptId);
  }, [receiptId, receipt.data, loadedReceipt]);
  const products = product
      ? [product]
      : receiptId
        ? (receipt.data?.data.products ?? [])
        : (query.data?.data ?? []),
    size = presets[preset] ?? { width: customWidth, height: customHeight },
    total = Object.values(selected).reduce((s, i) => s + i.quantity, 0);
  const validSize =
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width >= 30 &&
    size.width <= 100 &&
    size.height >= 25 &&
    size.height <= 100;
  const copies =
    job?.items.flatMap((line) =>
      Array.from({ length: line.quantity }, (_, copy) => ({
        line,
        key: `${line.variantId}-${copy}`,
      })),
    ) ?? [];
  useEffect(() => {
    if (!job) return;
    document.body.dataset.printKind = "labels";
    return () => {
      delete document.body.dataset.printKind;
    };
  }, [job]);
  function change(
    id: string,
    value: { variant: Variant; name: string; quantity: number } | null,
  ) {
    setSelected((old) => {
      const next = { ...old };
      if (value) next[id] = value;
      else delete next[id];
      return next;
    });
    setJob(null);
    setError("");
  }
  async function prepare() {
    setBusy(true);
    setError("");
    try {
      const response = await post("/barcodes/print-labels", {
        items: Object.entries(selected).map(([variantId, v]) => ({
          variantId,
          quantity: v.quantity,
        })),
      });
      setJob(response.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تجهيز الملصقات");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="barcode-workspace">
      {!product && (
        <>
          <div className="page-head">
            <div>
              <div className="eyebrow">A&Z • إدارة المنتجات</div>
              <h1>طباعة الباركود</h1>
              <p>
                اختَر المنتجات والمقاسات، وحدد عدد الملصقات ثم راجع المعاينة.
              </p>
            </div>
            <Link className="btn btn-outline" to="/products">
              العودة للمنتجات
            </Link>
          </div>
          {!receiptId ? (
            <div className="search">
              <Search size={18} />
              <input
                aria-label="البحث عن منتجات للباركود"
                placeholder="اسم المنتج، الكود أو الباركود"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setOffset(0);
                }}
              />
            </div>
          ) : (
            <p className="notice">
              هذه الملصقات تخص دفعة الاستلام المحددة. الأعداد تستبعد مرتجعات
              المورد المسجلة.
            </p>
          )}
        </>
      )}
      <section className="panel barcode-picker">
        <div className="panel-title">
          <h2>المقاسات والألوان</h2>
          <span>
            {Object.keys(selected).length} متغير • {total} ملصق
          </span>
        </div>
        {(receiptId ? receipt.isLoading : searchPending || query.isLoading) &&
        !product ? (
          <p className="barcode-help">جارٍ تحميل المنتجات...</p>
        ) : (receiptId ? receipt.error : query.error) && !product ? (
          <p role="alert" className="barcode-error">
            تعذر تحميل المنتجات.{" "}
            <Button
              variant="outline"
              onClick={() =>
                void (receiptId ? receipt.refetch() : query.refetch())
              }
            >
              إعادة المحاولة
            </Button>
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>اختيار</th>
                  <th>المنتج / المقاس / اللون</th>
                  <th>الباركود</th>
                  <th>عدد الملصقات</th>
                  <th>المخزون</th>
                </tr>
              </thead>
              <tbody>
                {products.flatMap((p) =>
                  p.variants
                    .filter((v) => v.active)
                    .map((v) => (
                      <tr key={v.id}>
                        <td>
                          <input
                            className="label-select"
                            type="checkbox"
                            aria-label={`اختيار ${v.sku}`}
                            checked={!!selected[v.id]}
                            onChange={(e) =>
                              change(
                                v.id,
                                e.target.checked
                                  ? { variant: v, name: p.nameAr, quantity: 1 }
                                  : null,
                              )
                            }
                          />
                        </td>
                        <td>
                          <strong>{p.nameAr}</strong>
                          <small>
                            {Object.values(v.options).join(" / ") || v.sku}
                          </small>
                        </td>
                        <td>
                          <code>{v.barcode}</code>
                        </td>
                        <td>
                          <input
                            className="label-quantity"
                            type="number"
                            min="1"
                            max="500"
                            step="1"
                            aria-label={`عدد ملصقات ${v.sku}`}
                            value={selected[v.id]?.quantity ?? 1}
                            disabled={!selected[v.id]}
                            onChange={(e) =>
                              change(v.id, {
                                variant: v,
                                name: p.nameAr,
                                quantity: Math.max(
                                  1,
                                  Math.min(
                                    500,
                                    Math.trunc(Number(e.target.value) || 1),
                                  ),
                                ),
                              })
                            }
                          />
                        </td>
                        <td>
                          <Button
                            variant="ghost"
                            disabled={!v.balances?.some((b) => b.quantity > 0)}
                            onClick={() =>
                              change(v.id, {
                                variant: v,
                                name: p.nameAr,
                                quantity: Math.min(
                                  500,
                                  v.balances!.reduce(
                                    (s, b) => s + b.quantity,
                                    0,
                                  ),
                                ),
                              })
                            }
                          >
                            حسب المخزون (
                            {v.balances?.reduce((s, b) => s + b.quantity, 0) ??
                              0}
                            )
                          </Button>
                        </td>
                      </tr>
                    )),
                )}
              </tbody>
            </table>
            {!products.length && (
              <p className="barcode-help">
                لا توجد منتجات. أضف منتجًا ومتغيراته أولًا.
              </p>
            )}
          </div>
        )}
        {!product && !receiptId && (
          <div className="pager">
            <span>{query.data?.total ?? 0} منتج</span>
            <Button
              variant="outline"
              disabled={!offset}
              onClick={() => setOffset((n) => Math.max(0, n - 30))}
            >
              السابق
            </Button>
            <Button
              variant="outline"
              disabled={(query.data?.data.length ?? 0) < 30}
              onClick={() => setOffset((n) => n + 30)}
            >
              التالي
            </Button>
          </div>
        )}
      </section>
      <section className="panel barcode-settings">
        <div className="form-grid">
          <Control label="نوع الورق">
            {(id) => (
              <select
                id={id}
                value={paper}
                onChange={(e) => setPaper(e.target.value)}
              >
                <option value="thermal">
                  طابعة ملصقات حرارية — ملصق لكل صفحة
                </option>
                <option value="a4">ورق A4 — عدة ملصقات في الصفحة</option>
              </select>
            )}
          </Control>
          <Control label="مقاس الملصق">
            {(id) => (
              <select
                id={id}
                value={preset}
                onChange={(e) => setPreset(e.target.value)}
              >
                <option value="40x30">40 × 30 مم</option>
                <option value="50x30">50 × 30 مم</option>
                <option value="60x40">60 × 40 مم</option>
                <option value="custom">مقاس مخصص</option>
              </select>
            )}
          </Control>
          {preset === "custom" && (
            <>
              <Control label="العرض (مم)">
                {(id) => (
                  <input
                    id={id}
                    type="number"
                    min="30"
                    max="100"
                    value={customWidth}
                    onChange={(e) => setCustomWidth(Number(e.target.value))}
                  />
                )}
              </Control>
              <Control label="الارتفاع (مم)">
                {(id) => (
                  <input
                    id={id}
                    type="number"
                    min="25"
                    max="100"
                    value={customHeight}
                    onChange={(e) => setCustomHeight(Number(e.target.value))}
                  />
                )}
              </Control>
            </>
          )}
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={showPrice}
            onChange={(e) => setShowPrice(e.target.checked)}
          />
          إظهار سعر البيع
        </label>
        <p className="barcode-help">
          في نافذة الطباعة: اختَر الطابعة، اضبط المقياس على 100%، وألغِ رؤوس
          وتذييلات الصفحة. الطباعة لا تغيّر المخزون.
        </p>
        {Object.values(selected).some(
          (i) =>
            (!/^\d+$/.test(i.variant.barcode) &&
              i.variant.barcode.length > 14) ||
            i.variant.barcode.length > 30,
        ) &&
          size.width < 60 && (
            <p className="barcode-warning">
              بعض الباركودات طويلة؛ استخدم ملصقًا أعرض وتأكد من قراءتها بالاسكانر
              قبل طباعة الكمية.
            </p>
          )}
        {error && (
          <p className="barcode-error" role="alert">
            {error}
          </p>
        )}
        {total > 500 && (
          <p className="barcode-error" role="alert">
            الحد الأقصى 500 ملصق في الدفعة.
          </p>
        )}
        <div className="head-actions">
          <Button
            disabled={!total || total > 500 || !validSize || busy}
            onClick={() => void prepare()}
          >
            <RefreshCw size={16} />
            {busy ? "جارٍ التجهيز..." : "معاينة الملصقات"}
          </Button>
          <Button
            variant="outline"
            disabled={!job || !validSize}
            onClick={() => window.print()}
          >
            <Printer size={17} />
            طباعة الملصقات
          </Button>
          <Button
            variant="ghost"
            disabled={!total}
            onClick={() => {
              setSelected({});
              setJob(null);
            }}
          >
            إلغاء التحديد
          </Button>
        </div>
      </section>
      {job && validSize && (
        <section className="panel barcode-preview-panel">
          <div className="panel-title">
            <h2>
              <ScanBarcode size={18} /> معاينة الطباعة
            </h2>
            <span>
              {copies.length} ملصق • {size.width} × {size.height} مم
            </span>
          </div>
          <div
            className="barcode-preview"
            style={
              {
                "--retail-label-width": `${size.width}mm`,
                "--retail-label-height": `${size.height}mm`,
              } as React.CSSProperties
            }
          >
            {copies.map((c) => (
              <Label
                key={c.key}
                line={c.line}
                storeName={job.storeName}
                price={showPrice}
              />
            ))}
          </div>
        </section>
      )}
      {job &&
        validSize &&
        createPortal(
          <div
            id="az-label-print-root"
            className={paper === "thermal" ? "thermal-labels" : "a4-labels"}
            style={
              {
                "--retail-label-width": `${size.width}mm`,
                "--retail-label-height": `${size.height}mm`,
              } as React.CSSProperties
            }
          >
            <style>{`@media print { @page { size: ${paper === "thermal" ? `${size.width}mm ${size.height}mm` : "A4"}; margin: ${paper === "thermal" ? "0" : "10mm"}; } }`}</style>
            {copies.map((c) => (
              <Label
                key={c.key}
                line={c.line}
                storeName={job.storeName}
                price={showPrice}
              />
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
