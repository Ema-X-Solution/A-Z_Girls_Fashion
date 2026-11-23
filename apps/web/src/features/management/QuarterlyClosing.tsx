import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, useSession } from "../../api";
import { Header } from "../shared/Controls";
import { notify, readableError } from "../../app/notifications";
const fmt = (v: string | number) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(v));
type Partner = { name: string; percent: string };
export function QuarterlyClosing() {
  const now = new Date(),
    [year, setYear] = useState(now.getFullYear()),
    [quarter, setQuarter] = useState(Math.ceil((now.getMonth() + 1) / 3)),
    [partners, setPartners] = useState<Partner[] | null>(null),
    [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const owner = useSession((s) => s.user?.roles.includes("OWNER"));
  const report = useQuery({
    queryKey: ["accounting", year, quarter],
    queryFn: () => api(`/accounting/period?year=${year}&quarter=${quarter}`),
  });
  const settings = useQuery({
    queryKey: ["accounting-partners"],
    queryFn: () => api("/accounting/partners"),
  });
  const batches = useQuery({
    queryKey: ["accounting-batches"],
    queryFn: () => api("/accounting/batches"),
  });
  const data = report.data?.data,
    rows = partners ?? settings.data?.data ?? [];
  async function save() {
    setBusy(true);
    try {
      await post("/accounting/partners", rows);
      await client.invalidateQueries({ queryKey: ["accounting"] });
      await client.invalidateQueries({ queryKey: ["accounting-partners"] });
      notify("تم حفظ نسب الشركاء. الإقفالات السابقة لا تتغير");
    } catch (e) {
      notify(readableError(e), true);
    } finally {
      setBusy(false);
    }
  }
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
      className="panel management-card"
      style={{ marginBottom: 24 }}
      dir="rtl"
    >
      <Header
        title="إقفال الأرباح ربع السنوي"
        subtitle="تكلفة FIFO حسب الدفعات. المبيعات بدون الضريبة، والمرتجعات تخص تاريخ تسجيلها. الإقفال نهائي."
      />
      <div
        className="management-tools"
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
              gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))",
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
              <div key={key} className="panel" style={{ padding: 16 }}>
                <div>{name}</div>
                <strong
                  style={{ fontSize: 23 }}
                  dir="ltr"
                  data-testid={`quarter-${key}`}
                >
                  {fmt(data.figures[key!])}
                </strong>
                <small> ج.م</small>
              </div>
            ))}
          </div>
          <p style={{ lineHeight: 1.8 }}>
            الرقمان الإضافيان للعرض والمقارنة فقط: صافي الربح مضافًا إليه أو
            مخصومًا منه صافي ضريبة المبيعات المسجلة بالفواتير بعد ضريبة
            المرتجعات. الضريبة هنا على المبيعات، وليست ضريبة على الربح. صافي
            الربح الأساسي لا يشمل ضريبة المبيعات أصلًا، وخصمها مرة أخرى ليس حسابًا
            لضريبة الدخل. توزيع الشركاء لم يتغير، ويظل على صافي الربح بدون ضريبة
            المبيعات.
          </p>
          <h3>توزيع أرباح الفترة {data.closed ? "المحفوظ" : "الحالي"}</h3>
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
                    <bdi>{fmt(p.share)}</bdi> ج.م
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.partners.length && <p>لم تُسجل نسب الشركاء بعد</p>}
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
              {new Date(data.createdAt).toLocaleString("ar-EG", {
                timeZone: "Africa/Cairo",
              })}
              . أي مرتجع لاحق يُسجل في الفترة المفتوحة ولا يغير هذا الإقفال.
            </p>
          )}
        </>
      )}
      {owner && (
        <details style={{ marginTop: 20 }}>
          <summary>إعداد أسماء الشركاء ونسبهم</summary>
          <p>مجموع النسب 100%. التعديل يخص الفترات المفتوحة فقط.</p>
          {rows.map((p: Partner, i: number) => (
            <div key={i} style={{ display: "flex", gap: 8, margin: 8 }}>
              <input
                aria-label={`اسم الشريك ${i + 1}`}
                value={p.name}
                onChange={(e) =>
                  setPartners(
                    rows.map((x: Partner, j: number) =>
                      j === i ? { ...x, name: e.target.value } : x,
                    ),
                  )
                }
              />
              <input
                aria-label={`نسبة الشريك ${i + 1}`}
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={p.percent}
                onChange={(e) =>
                  setPartners(
                    rows.map((x: Partner, j: number) =>
                      j === i ? { ...x, percent: e.target.value } : x,
                    ),
                  )
                }
              />
              <button
                onClick={() =>
                  setPartners(rows.filter((_: Partner, j: number) => i !== j))
                }
              >
                حذف
              </button>
            </div>
          ))}
          <button
            onClick={() => setPartners([...rows, { name: "", percent: "0" }])}
          >
            إضافة شريك
          </button>{" "}
          <button disabled={busy} onClick={() => void save()}>
            حفظ نسب الشركاء
          </button>
        </details>
      )}
      <details style={{ marginTop: 20 }}>
        <summary>دفعات المخزون وتكلفتها (حتى 200 دفعة)</summary>
        <table style={{ width: "100%" }}>
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
                <td>{fmt(b.unitCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
              }
