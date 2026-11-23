import { formatMoney } from "../../i18n";
import { Pagination } from "../../components/application/Pagination";
import { usePagination } from "../../hooks/usePagination";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, useSession } from "../../api";
import { PartnerSettings } from "./PartnerSettings";
import { Header } from "../shared/Controls";
import { notify, readableError } from "../../app/notifications";
type Partner = { name: string; percent: string };
export function QuarterlyClosing() {
  const now = new Date(),
    [year, setYear] = useState(now.getFullYear()),
    [quarter, setQuarter] = useState(Math.ceil((now.getMonth() + 1) / 3)),
    [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const owner = useSession((s) => s.user?.roles.includes("OWNER"));
  const report = useQuery({
    queryKey: ["accounting", year, quarter],
    queryFn: () => api(`/accounting/period?year=${year}&quarter=${quarter}`),
  });
  const paging = usePagination("accounting-batches", true, "local");
  const batches = useQuery({
    queryKey: ["accounting-batches", paging.query],
    queryFn: () => api(`/accounting/batches?${paging.query}`),
  });
  const data = report.data?.data;
  async function close() {
    if (
      !window.confirm(
        `إقفال الربع ${quarter} لسنة ${year} نهائي. لا يمكن تعديل الأرقام أو فك الإقفال. هل تؤكد؟`,
      )
    )
      return;
    setBusy(true);
    try {
      await post("/accounting/close", { year, quarter, confirm: true });
      await client.invalidateQueries({ queryKey: ["accounting"] });
      notify("تم إقفال الفترة وتجميد الأرقام");
    } catch (e) {
      notify(readableError(e), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel management-card quarterly-closing"
      style={{ marginBottom: 24 }}
      dir="rtl"
    >
      <Header
        title="إقفال الأرباح ربع السنوي"
        subtitle="تكلفة FIFO حسب الدفعات. المبيعات بدون الضريبة، والمرتجعات تخص تاريخ تسجيلها. الإقفال نهائي."
      />
      {owner && <PartnerSettings />}
      <div
        className="management-tools closing-period-controls"
        style={{
          display: "flex",
          gap: 16,
          alignItems: "end",
          flexWrap: "wrap",
        }}
      >
        <label>
          السنة
          <input
            aria-label="سنة الإقفال"
            type="number"
            min="2020"
            max="2100"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </label>
        <label>
          الربع
          <select
            aria-label="ربع الإقفال"
            value={quarter}
            onChange={(e) => setQuarter(Number(e.target.value))}
          >
            <option value={1}>يناير - مارس</option>
            <option value={2}>أبريل - يونيو</option>
            <option value={3}>يوليو - سبتمبر</option>
            <option value={4}>أكتوبر - ديسمبر</option>
          </select>
        </label>
        <strong>
          {data?.closed
            ? "الفترة مقفلة، الأرقام محفوظة"
            : "الفترة مفتوحة، الأرقام قابلة للتغير"}
        </strong>
      </div>
      {report.isError && <p role="alert">{readableError(report.error)}</p>}
      {data && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit,minmax(min(170px,100%),1fr))",
              gap: 12,
              margin: "20px 0",
            }}
          >
            {[
              ["صافي المبيعات", "netSales"],
              ["تكلفة البضاعة المباعة", "costOfGoodsSold"],
              ["المصروفات", "expenses"],
              ["التالف", "stockDamageCost"],
              ["فرق مرتجع المورد", "purchaseReturnVariance"],
              ["صافي الربح بدون ضريبة المبيعات", "netProfit"],
              ["صافي ضريبة المبيعات", "tax"],
              ["الربح + ضريبة المبيعات", "profitPlusSalesVat"],
              ["الربح − ضريبة المبيعات", "profitMinusSalesVat"],
            ].map(([name, key]) => (
              <div
                key={key}
                className="panel closing-metric"
                style={{ padding: 16 }}
              >
                <div>{name}</div>
                <strong
                  style={{ fontSize: 23 }}
                  dir="ltr"
                  data-testid={`quarter-${key}`}
                >
                  {formatMoney(data.figures[key!])}
                </strong>
              </div>
            ))}
          </div>
          <p className="closing-note" style={{ lineHeight: 1.8 }}>
            الرقمان الإضافيان للعرض والمقارنة فقط: صافي الربح مضافًا إليه أو
            مخصومًا منه صافي ضريبة المبيعات المسجلة بالفواتير بعد ضريبة
            المرتجعات. الضريبة هنا على المبيعات، وليست ضريبة على الربح. صافي
            الربح الأساسي لا يشمل ضريبة المبيعات أصلًا، وخصمها مرة أخرى ليس حسابًا
            لضريبة الدخل. توزيع الشركاء لم يتغير، ويظل على صافي الربح بدون ضريبة
            المبيعات.
          </p>
          <h3>توزيع أرباح الفترة {data.closed ? "المحفوظ" : "الحالي"}</h3>
          <div style={{ overflowX: "auto", maxWidth: "100%" }}>
            <table className="data-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>الشريك</th>
                  <th>النسبة</th>
                  <th>نصيب الربح / الخسارة</th>
                </tr>
              </thead>
              <tbody>
                {data.partners.map((p: Partner & { share: string }) => (
                  <tr key={p.name}>
                    <td>{p.name}</td>
                    <td>{p.percent}%</td>
                    <td>
                      <bdi>{formatMoney(p.share)}</bdi>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.partners.length && (
            <p className="closing-empty">لم تُسجل نسب الشركاء بعد</p>
          )}
          {owner && !data.closed && (
            <button
              style={{ marginTop: 16 }}
              disabled={busy || !data.partners.length}
              onClick={() => void close()}
            >
              إقفال الفترة نهائيًا
            </button>
          )}
          {data.closed && (
            <p>
              تاريخ الإقفال:{" "}
              {new Date(data.createdAt).toLocaleString("en-GB", {
                timeZone: "Africa/Cairo",
              })}
              . أي مرتجع لاحق يُسجل في الفترة المفتوحة ولا يغير هذا الإقفال.
            </p>
          )}
        </>
      )}
      <details className="closing-batches" style={{ marginTop: 20 }}>
        <summary>دفعات المخزون وتكلفتها</summary>
        {batches.isError && (
          <p role="alert">
            {readableError(batches.error)}{" "}
            <button onClick={() => void batches.refetch()}>
              إعادة تحميل الدفعات
            </button>
          </p>
        )}
        {batches.isPending && <p role="status">جارٍ تحميل دفعات المخزون...</p>}
        <div style={{ overflowX: "auto", maxWidth: "100%" }}>
          <table style={{ width: "100%", minWidth: 600 }}>
            <thead>
              <tr>
                <th>الصنف</th>
                <th>الكود</th>
                <th>تاريخ الدفعة</th>
                <th>الكمية الأصلية</th>
                <th>المتبقي</th>
                <th>تكلفة الوحدة</th>
              </tr>
            </thead>
            <tbody>
              {batches.data?.data.map((b: any) => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td>{b.sku}</td>
                  <td>
                    {new Date(b.acquiredAt).toLocaleDateString("en-GB", {
                      timeZone: "Africa/Cairo",
                    })}
                  </td>
                  <td>{b.quantity}</td>
                  <td>{b.remaining}</td>
                  <td>
                    <bdi>{formatMoney(b.unitCost)}</bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!batches.isPending &&
          !batches.isError &&
          !batches.data?.data.length && <p>لا توجد دفعات مخزون</p>}
        <Pagination
          page={paging.page}
          pageSize={paging.pageSize}
          onPageChange={paging.setPage}
          onPageSizeChange={paging.setPageSize}
          total={batches.data?.total ?? 0}
          length={batches.data?.data.length ?? 0}
          disabled={batches.isFetching || batches.isError}
          unit="دفعة"
        />
      </details>
    </section>
  );
}
