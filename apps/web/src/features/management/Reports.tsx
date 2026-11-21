import { useState } from "react";
import { Header, ErrorMessage } from "../shared/Controls";
import {
  Grid,
  useRows,
  Pagination,
  FormField,
  PageState,
  allowed,
} from "./Tools";
import { useDebouncedSearch } from "../../hooks/useDebouncedSearch";
import "./management.css";
const types = [
  ["daily", "المبيعات اليومية"],
  ["monthly", "المبيعات الشهرية"],
  ["category", "حسب التصنيف"],
  ["product", "حسب المنتج"],
  ["variant", "حسب المقاس واللون"],
  ["cashier", "حسب الكاشير"],
  ["cashier-invoices", "فواتير كاشير محدد"],
  ["payments", "طرق الدفع"],
  ["returns", "المرتجعات"],
  ["discounts", "الخصومات"],
  ["purchases", "المشتريات"],
  ["suppliers", "أرصدة الموردين"],
  ["inventory", "تقييم المخزون"],
  ["low-stock", "المخزون المنخفض"],
  ["movements", "حركات المخزون"],
  ["expenses", "المصروفات"],
  ["gross-profit", "مجمل الربح"],
  ["net-profit", "صافي الربح"],
  ["shifts", "الورديات"],
];
const localDate = (v: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(v);
export function Reports() {
  const [kind, setKind] = useState("daily"),
    [offset, setOffset] = useState(0),
    [q, setQ] = useState(""),
    [cashierId, setCashierId] = useState(""),
    [from, setFrom] = useState(localDate(new Date(Date.now() - 30 * 86400000))),
    [to, setTo] = useState(localDate(new Date()));
  const { debounced, searchPending } = useDebouncedSearch(q);
  // Send explicit Egypt calendar boundaries; Intl resolves Cairo's seasonal offset for each date.
  function boundary(day: string, end = false) {
    const target = end
      ? new Date(new Date(day + "T00:00:00Z").getTime() + 86400000)
          .toISOString()
          .slice(0, 10)
      : day;
    const center = new Date(target + "T00:00:00Z").getTime();
    let low = center - 18 * 3600000,
      high = center + 18 * 3600000;
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      if (localDate(new Date(mid)) >= target) high = mid;
      else low = mid;
    }
    return new Date(high - (end ? 1 : 0)).toISOString();
  }
  const valid =
    !!from &&
    !!to &&
    from <= to &&
    new Date(to).getTime() - new Date(from).getTime() < 366 * 86400000;
  const params = new URLSearchParams({
    from: valid ? boundary(from) : "",
    to: valid ? boundary(to, true) : "",
    q: debounced,
  });
  const cashiers = useRows("/reports/cashiers", kind === "cashier-invoices"),
    path = `/reports/detail/${kind}?${params}${cashierId ? `&cashierId=${cashierId}` : ""}`,
    query = useRows(
      `${path}&offset=${offset}`,
      valid && !searchPending && (kind !== "cashier-invoices" || !!cashierId),
    );
  const visibleTypes = types.filter(
    (t) =>
      !["purchases", "suppliers", "gross-profit", "net-profit"].includes(
        t[0]!,
      ) || allowed("reports.profit"),
  );
  return (
    <>
      <Header
        title="التقارير التفصيلية"
        subtitle="الفترات بتوقيت القاهرة؛ صافي المبيعات يعكس مرتجعات الفترة، والأرصدة المخزنية وأرصدة الموردين حالية"
      />
      <section className="panel management-card">
        <div className="management-tools report-controls">
          <FormField label="نوع التقرير">
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setOffset(0);
              }}
            >
              {visibleTypes.map((t) => (
                <option value={t[0]} key={t[0]}>
                  {t[1]}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="من تاريخ">
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setOffset(0);
              }}
            />
          </FormField>
          <FormField label="إلى تاريخ">
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setOffset(0);
              }}
            />
          </FormField>
          <FormField label="بحث داخل التقرير">
            <input
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOffset(0);
              }}
            />
          </FormField>
          {kind === "cashier-invoices" && (
            <FormField label="الكاشير">
              <select
                value={cashierId}
                onChange={(e) => {
                  setCashierId(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">اختر الكاشير...</option>
                {(cashiers.data?.data ?? []).map((cashier: { id: string; name: string; sellerCode: string }) => (
                  <option key={cashier.id} value={cashier.id}>
                    {cashier.name} ({cashier.sellerCode})
                  </option>
                ))}
              </select>
            </FormField>
          )}
        </div>
        <ErrorMessage
          message={!valid ? "اختار فترة صحيحة لا تتجاوز 366 يومًا" : ""}
        />
        <div className="inline-actions report-controls">
          {valid && !searchPending && (kind !== "cashier-invoices" || cashierId) && (
            <>
              <a className="btn btn-outline" href={`/api${path}&format=xlsx`}>
                تصدير Excel
              </a>
              <a className="btn btn-outline" href={`/api${path}&format=pdf`}>
                تصدير PDF
              </a>
              <button
                className="btn btn-outline"
                onClick={() => {
                  document.body.classList.add("report-print");
                  window.print();
                  document.body.classList.remove("report-print");
                }}
              >
                طباعة الصفحة الحالية
              </button>
            </>
          )}
        </div>
        <h2>{query.data?.title ?? "التقرير"}</h2>
        <p className="management-note">
          {from} — {to} • {query.data?.total ?? 0} صف. التصدير يشمل كل النتائج
          المطابقة حتى 10000 صف. تكلفة المخزون والربح تظهر وفق الصلاحية.
        </p>
        {searchPending ? (
          <p>جارٍ البحث...</p>
        ) : (
          <>
            <PageState query={query} />
            <Grid
              rows={valid ? (query.data?.data ?? []) : []}
              columns={(query.data?.columns ?? []).map(
                (c: { key: string; label: string }) => ({
                  label: c.label,
                  render: (r: Record<string, unknown>) =>
                    String(r[c.key] ?? "—"),
                }),
              )}
            />
          </>
        )}
        <div className="report-controls">
          <Pagination
            offset={offset}
            onChange={setOffset}
            total={query.data?.total ?? 0}
          />
        </div>
      </section>
    </>
  );
}
