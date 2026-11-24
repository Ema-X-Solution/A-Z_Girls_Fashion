import { SmartSelect } from "../../components/application/SmartSelect";
import { Pagination } from "../../components/application/Pagination";
import { usePagination } from "../../hooks/usePagination";
import { useState } from "react";
import { Header, ErrorMessage } from "../shared/Controls";
import { Grid, useRows, FormField, PageState, allowed } from "./Tools";
import { useDebouncedSearch } from "../../hooks/useDebouncedSearch";
import { FileSpreadsheet, FileText, Printer, Search } from "lucide-react";
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
  const paging = usePagination(
    `${kind}|${from}|${to}|${debounced}|${cashierId}`,
  );
  const path = `/reports/detail/${kind}?${params}${cashierId ? `&cashierId=${cashierId}` : ""}`,
    query = useRows(
      `${path}&${paging.query}`,
      valid && !searchPending && (kind !== "cashier-invoices" || !!cashierId),
    );
  const exportLimited = (query.data?.total ?? 0) > 10000;
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
        <div className="report-top">
          <div className="management-tools report-controls">
            <FormField label="نوع التقرير">
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  paging.setPage(1);
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
                  paging.setPage(1);
                }}
              />
            </FormField>
            <FormField label="إلى تاريخ">
              <input
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  paging.setPage(1);
                }}
              />
            </FormField>
            <div className="search report-search">
              <Search size={18} />
              <input
                type="search"
                aria-label="بحث داخل التقرير"
                placeholder="بحث داخل التقرير"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  paging.setPage(1);
                }}
              />
            </div>
            {kind === "cashier-invoices" && (
              <FormField label="الكاشير">
                <SmartSelect
                  id="report-cashier"
                  name="cashierId"
                  label="الكاشير"
                  placeholder="ابحث باسم الكاشير أو الكود"
                  value={cashierId}
                  endpoint="/reports/cashiers"
                  optionLabel={(row) => `${row.name} (${row.sellerCode})`}
                  onChange={(row) => {
                    setCashierId(row.id);
                    paging.setPage(1);
                  }}
                />
              </FormField>
            )}
          </div>
          <ErrorMessage
            message={!valid ? "اختار فترة صحيحة لا تتجاوز 366 يومًا" : ""}
          />
          {(query.data?.total ?? 0) >= 10000 && (
            <div className="notice" role={exportLimited ? "alert" : "status"}>
              {exportLimited
                ? "عدد النتائج أكبر من حد التصدير (10,000 صف). ضيّق الفترة أو البحث أولًا؛ لن يتم تنزيل ملف ناقص."
                : "وصل التقرير إلى حد التصدير: 10,000 صف. يشمل التصدير كل هذه النتائج."}
            </div>
          )}
          <div className="inline-actions report-controls">
            {valid &&
              !searchPending &&
              (kind !== "cashier-invoices" || cashierId) && (
                <>
                  <a
                    className="btn btn-outline report-action"
                    aria-disabled={exportLimited}
                    href={exportLimited ? undefined : `/api${path}&format=xlsx`}
                  >
                    <FileSpreadsheet size={16} />
                    تصدير Excel
                  </a>
                  <a
                    className="btn btn-outline report-action"
                    aria-disabled={exportLimited}
                    href={exportLimited ? undefined : `/api${path}&format=pdf`}
                  >
                    <FileText size={16} />
                    تصدير PDF
                  </a>
                  <button
                    className="btn report-print-btn"
                    onClick={() => {
                      document.body.classList.add("report-print");
                      window.print();
                      document.body.classList.remove("report-print");
                    }}
                  >
                    <Printer size={16} />
                    طباعة الصفحة الحالية
                  </button>
                </>
              )}
          </div>
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
            {kind === "cashier" ? (
              <>
                <p className="management-note">
                  العمولة على إجمالي الفواتير شامل الضريبة بعد خصم المرتجعات،
                  بالنسبة الحالية في الإعدادات.
                </p>
                {(valid ? (query.data?.data ?? []) : []).map(
                  (row: Record<string, unknown>, index: number) => (
                    <section
                      key={String(row.label ?? index)}
                      className="panel cashier-report-card"
                    >
                      <h3>{String(row.label ?? "كاشير")}</h3>
                      <p className="cashier-commission">
                        <span>
                          نسبة العمولة:{" "}
                          <b>{String(row.commissionRate ?? "1.00")}%</b>
                        </span>
                        <span>
                          قيمة العمولة:{" "}
                          <b>{String(row.commission ?? "0.00")} EGP</b>
                        </span>
                      </p>
                      <Grid
                        rows={[row]}
                        columns={(query.data?.columns ?? [])
                          .filter(
                            (c: { key: string }) =>
                              ![
                                "label",
                                "commissionRate",
                                "commission",
                              ].includes(c.key),
                          )
                          .map((c: { key: string; label: string }) => ({
                            label: c.label,
                            render: (r: Record<string, unknown>) =>
                              String(r[c.key] ?? "—"),
                          }))}
                      />
                    </section>
                  ),
                )}
              </>
            ) : (
              <div
                className={kind === "daily" ? "report-daily-cards" : undefined}
              >
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
              </div>
            )}
          </>
        )}
        <div className="report-controls">
          <Pagination
            page={paging.page}
            pageSize={paging.pageSize}
            onPageChange={paging.setPage}
            onPageSizeChange={paging.setPageSize}
            length={query.data?.data.length ?? 0}
            total={query.data?.total ?? 0}
            disabled={query.isFetching}
          />
        </div>
      </section>
    </>
  );
}
