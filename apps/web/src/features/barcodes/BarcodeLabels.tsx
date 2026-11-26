import { EntitySelect } from "../../components/application/EntitySelect";
import type { PaginatedResult } from "@az/shared";
import { TableSkeleton } from "../../components/application/Skeleton";
import { Pagination } from "../../components/application/Pagination";
import { usePagination } from "../../hooks/usePagination";
import { formatDigits } from "../../i18n";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Printer, Search, ScanBarcode, RefreshCw } from "lucide-react";
import JsBarcode from "jsbarcode";
import { api, post } from "../../api";
import { Button } from "../../components/ui/button";
import { useDebouncedSearch } from "../../hooks/useDebouncedSearch";

type Variant = {
  id: string;
  sku: string;
  barcode: string;
  price: string;
  active: boolean;
  options: Record<string, string>;
  balances?: { locationId?: string; quantity: number }[];
};
type Product = { id: string; nameAr: string; variants: Variant[] };
type Line = {
  variantId: string;
  name: string;
  supplierCode?: string | null;
  productSupplierCode?: string | null;
  sku: string;
  barcode: string;
  price: string;
  options: Record<string, string>;
  quantity: number;
};
type Job = { storeName: string; items: Line[] };
const presets: Record<string, { width: number; height: number }> = {
  "40x25": { width: 40, height: 25 },
  "40x30": { width: 40, height: 30 },
  "50x30": { width: 50, height: 30 },
  "60x40": { width: 60, height: 40 },
};
function Control({
  label,
  hideLabel = false,
  children,
}: {
  label: string;
  hideLabel?: boolean;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      {hideLabel ? null : <label htmlFor={id}>{label}</label>}
      {children(id)}
    </div>
  );
}
function Label({
  line,
  storeName,
  price,
  compact,
}: {
  line: Line;
  storeName: string;
  price: boolean;
  compact: boolean;
}) {
  const optionEntries = Object.entries(line.options).filter(([, value]) => value.trim());
  const color = optionEntries.filter(([key]) => /^(color|colour|اللون)$/i.test(key.trim())).map(([, value]) => formatDigits(value.trim())).join(" / ");
  const size = optionEntries.filter(([key]) => !/^(color|colour|اللون)$/i.test(key.trim())).map(([, value]) => formatDigits(value.trim())).join(" / ");
  const supplierCode = line.supplierCode || "";
  const productCode = line.productSupplierCode?.trim() ?? "";
  return (
    <article
      className={`retail-label${compact ? " retail-label-40x25" : ""}${compact && !price ? " retail-label-no-price" : ""}`}
      data-barcode={line.barcode}
      dir="ltr"
      lang="en"
    >
      <strong className="label-store">{storeName}</strong>
      <div className="label-name" dir={compact ? "auto" : undefined}>
        {productCode ? `${line.name} - ${productCode}` : line.name}
      </div>
      <div className="label-options">
        <span className="label-size" dir="auto">{size}</span>
        <span className="label-supplier">{supplierCode}</span>
        <span className="label-color" dir="auto">{color}</span>
      </div>
      <svg
        aria-label={`Barcode ${line.barcode}`}
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
          svg.setAttribute(
            "viewBox",
            compact
              ? `0 0 ${Number.parseFloat(w ?? "0")} ${Number.parseFloat(h ?? "0")}`
              : `0 0 ${w} ${h}`,
          );
          svg.removeAttribute("width");
          svg.removeAttribute("height");
          svg.setAttribute(
            "preserveAspectRatio",
            compact ? "none" : "xMidYMid meet",
          );
        }}
      />
      <div className="label-number" dir="ltr">
        {line.barcode}
      </div>
      {price && (
        <b className="label-price">
          {new Intl.NumberFormat("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(Number(line.price))}{" "}
          EGP
        </b>
      )}
    </article>
  );
}

// Quantities use the balances in the current warehouse view.
// Never silently cap this at 500.
function stockQuantity(variant: Variant) {
  return Math.max(0, variant.balances?.reduce((sum, balance) => sum + balance.quantity, 0) ?? 0);
}

export function BarcodeLabels({ product }: { product?: Product }) {
  const [params] = useSearchParams(),
    receiptId = product ? null : params.get("receiptId"),
    [loadedReceipt, setLoadedReceipt] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [q, setQ] = useState(""),
    [selected, setSelected] = useState<
      Record<string, { variant: Variant; name: string; quantity: number }>
    >(() =>
      Object.fromEntries(
        (product?.variants.filter((v) => v.active) ?? []).map((v) => [
          v.id,
          { variant: v, name: product!.nameAr, quantity: stockQuantity(v) },
        ]),
      ),
    ),
    [preset, setPreset] = useState("40x25"),
    [customWidth, setCustomWidth] = useState(50),
    [customHeight, setCustomHeight] = useState(30),
    [paper, setPaper] = useState("thermal"),
    [showPrice, setShowPrice] = useState(true),
    [job, setJob] = useState<Job | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const { debounced: debouncedQ, searchPending } = useDebouncedSearch(q);
  const paging = usePagination(`${q.trim()}|${supplierId}|${locationId}`, !product && !receiptId);
  const query = useQuery({
    queryKey: ["barcode-catalog", debouncedQ, supplierId, locationId, paging.page, paging.pageSize],
    queryFn: ({ signal }) =>
      api<PaginatedResult<Product>>(
        `/products?q=${encodeURIComponent(debouncedQ)}&${paging.query}${supplierId ? `&supplierId=${encodeURIComponent(supplierId)}` : ""}${locationId ? `&locationId=${encodeURIComponent(locationId)}` : ""}`,
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
        : (query.data?.data ?? []).map((item) => locationId ? {
            ...item,
            variants: item.variants
              .filter((variant) => variant.balances?.some((balance) => balance.locationId === locationId))
              .map((variant) => ({ ...variant, balances: variant.balances?.filter((balance) => balance.locationId === locationId) })),
          } : item),
    size = presets[preset] ?? { width: customWidth, height: customHeight },
    total = Object.values(selected).reduce((s, i) => s + i.quantity, 0),
    printableCount = Object.values(selected).filter((item) => item.quantity > 0).length,
    overLimit = total > 500 || printableCount > 100;
  const visibleVariants = products.flatMap((p) =>
    p.variants.filter((v) => v.active).map((variant) => ({ variant, name: p.nameAr })),
  );
  const visibleSelected = visibleVariants.filter(({ variant }) => !!selected[variant.id]).length;
  const allVisibleSelected = visibleVariants.length > 0 && visibleSelected === visibleVariants.length;
  function selectVisible(checked: boolean) {
    setSelected((old) => {
      const next = { ...old };
      for (const { variant, name } of visibleVariants) {
        if (checked) next[variant.id] ??= { variant, name, quantity: receiptId ? (receipt.data?.data.quantities[variant.id] ?? 0) : stockQuantity(variant) };
        else delete next[variant.id];
      }
      return next;
    });
    setJob(null);
    setError("");
  }
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
    if (!total || overLimit) return;
    setBusy(true);
    setError("");
    try {
      const response = await post("/barcodes/print-labels", {
        items: Object.entries(selected).filter(([, value]) => value.quantity > 0).map(([variantId, v]) => ({
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
            <>
              <div className="barcode-catalog-filters">
                <Control label="البحث" hideLabel>
                  {() => <div className="search">
                    <Search size={18} />
                    <input
                      aria-label="البحث عن منتجات للباركود"
                      placeholder="اسم المنتج، الكود أو الباركود"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                    />
                  </div>}
                </Control>
                <Control label="المورد الأساسي" hideLabel>
                  {(id) => <EntitySelect kind="suppliers" id={id} name="barcodeSupplierId" label="تصفية حسب المورد الأساسي" required={false} value={supplierId} onChange={(value) => {
                    setSupplierId(value); setSelected({}); setJob(null); setError("");
                  }} />}
                </Control>
                <Control label="المخزن" hideLabel>
                  {(id) => <EntitySelect kind="locations" id={id} name="barcodeLocationId" label="المخزن" required={false} value={locationId} onChange={(value) => {
                    setLocationId(value); setSelected({}); setJob(null); setError("");
                  }} />}
                </Control>
              </div>
              <p className="barcode-help">تغيير المورد أو المخزن يلغي الاختيارات السابقة. اترك الفلتر فارغًا لعرض الكل. كمية المخزون تخص المخزن المختار، أو إجمالي المخازن عند عرض الكل.</p>
            </>
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
          <TableSkeleton columns={5} label="جارٍ تحميل منتجات الباركود" />
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
                  <th>
                    <label>
                      <input
                        className="label-select"
                        type="checkbox"
                        aria-label="اختيار كل الظاهر في الصفحة"
                        checked={allVisibleSelected}
                        disabled={!visibleVariants.length}
                        ref={(input) => {
                          if (input) input.indeterminate = visibleSelected > 0 && !allVisibleSelected;
                        }}
                        onChange={(e) => selectVisible(e.target.checked)}
                      />{" "}
                      اختيار كل الظاهر في الصفحة
                    </label>
                  </th>
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
                                  ? { variant: v, name: p.nameAr, quantity: receiptId ? (receipt.data?.data.quantities[v.id] ?? 0) : stockQuantity(v) }
                                  : null,
                              )
                            }
                          />
                        </td>
                        <td>
                          <strong>{p.nameAr}</strong>
                          <small>
                            {formatDigits(
                              Object.values(v.options).join(" / "),
                            ) || v.sku}
                          </small>
                        </td>
                        <td>
                          <code>{v.barcode}</code>
                        </td>
                        <td>
                          <input
                            className="label-quantity"
                            type="number"
                            min="0"
                            step="1"
                            aria-label={`عدد ملصقات ${v.sku}`}
                            value={selected[v.id]?.quantity ?? (receiptId ? (receipt.data?.data.quantities[v.id] ?? 0) : stockQuantity(v))}
                            disabled={!selected[v.id]}
                            onChange={(e) =>
                              change(v.id, {
                                variant: v,
                                name: p.nameAr,
                                quantity: Math.max(0, Math.trunc(Number(e.target.value) || 0)),
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
                                quantity: stockQuantity(v),
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
          <Pagination page={paging.page} pageSize={paging.pageSize}
            onPageChange={paging.setPage} onPageSizeChange={paging.setPageSize}
            length={query.data?.data.length ?? 0} total={query.data?.total ?? 0}
            disabled={query.isFetching || searchPending} unit="منتج" />
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
                <option value="40x25">40 × 25 مم</option>
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
        <p className="barcode-help">
          {receiptId
            ? "الكمية الافتراضية حسب الكمية المستلمة في الفاتورة بعد المرتجعات."
            : "الكمية الافتراضية هي صافي المخزون في كل المخازن. الصفر أو الرصيد السالب لا يطبع ملصقات."}
          {" "}يمكن تعديل عدد الملصقات يدويًا؛ الكمية صفر تستبعد الصنف من الطباعة.
        </p>
        {overLimit && (
          <p className="barcode-error" role="alert">
            اخترت {printableCount} متغيرًا بإجمالي {total} ملصق. الحد الأقصى للدفعة 100 متغير و500 ملصق. قلل الكميات أو قسم الطباعة على دفعات؛ لم يتم تقليل الكميات تلقائيًا.
          </p>
        )}
        <div className="head-actions">
          <Button
            disabled={!total || overLimit || !validSize || busy}
            onClick={() => void prepare()}
          >
            <RefreshCw size={16} />
            {busy ? "جارٍ التجهيز..." : "معاينة الملصقات"}
          </Button>
          <Button
            variant="outline"
            disabled={!job || !validSize || copies.length === 0}
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
              {copies.length === 0
                ? "لا توجد ملصقات بعد. اضبط عدد الملصقات على 1 أو أكثر."
                : `${copies.length} ملصق • ${size.width} × ${size.height} مم`}
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
                compact={size.width === 40 && size.height === 25}
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
                compact={size.width === 40 && size.height === 25}
              />
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
