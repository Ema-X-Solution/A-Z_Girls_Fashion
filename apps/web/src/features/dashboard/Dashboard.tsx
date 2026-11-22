import { useState } from "react";
import { Link } from "react-router-dom";
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ShoppingBag, ScanBarcode, Boxes, Receipt, ChartNoAxesCombined, Plus, ArrowUpLeft } from "lucide-react";
import { useSession } from "../../api";
import { ar, formatMoney as fm } from "../../i18n";
import { useData, useAllowed } from "../../hooks/useData";
import { Loading, ErrorState, Empty, Header } from "../../components/application/Primitives";

export function Dashboard({ reports = false }: { reports?: boolean }) {
  const posAllowed = useAllowed("pos.access");
  const [days, setDays] = useState("30"),
    [range] = useState(() => new Date()),
    from = new Date(range.getTime() - Number(days) * 86400000).toISOString(),
    to = range.toISOString(),
    query = useData(`/reports/dashboard?from=${from}&to=${to}`),
    d = query.data?.data,
    user = useSession((s) => s.user)!;
  return (
    <>
      <Header
        title={reports ? ar.reports : `أهلاً، ${user.name}`}
        subtitle={
          reports
            ? "الأرقام التي تساعدك على اتخاذ القرار"
            : "كل ما تحتاجه لمتابعة متجرك، في مكان واحد."
        }
      >
        <select
          aria-label="الفترة"
          value={days}
          onChange={(e) => setDays(e.target.value)}
        >
          <option value="1">آخر 24 ساعة</option>
          <option value="7">آخر 7 أيام</option>
          <option value="30">آخر 30 يوماً</option>
          <option value="365">آخر سنة</option>
        </select>
        {reports ? (
          <a
            className="btn btn-outline"
            href={`/api/reports/sales/export?from=${from}&to=${to}`}
          >
            تصدير Excel
          </a>
        ) : (
          posAllowed && (
            <Link className="btn btn-primary" to="/pos">
              <Plus size={18} /> عملية بيع جديدة
            </Link>
          )
        )}
      </Header>
      {query.isLoading ? (
        <Loading />
      ) : query.error ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        d && (
          <>
            <div className="stat-grid">
              {[
                {
                  label: "إجمالي المبيعات شامل الضريبة",
                  value: fm(d.totalSalesWithTax),
                  icon: Receipt,
                },
                {
                  label: "الفواتير المكتملة",
                  value: d.orders,
                  icon: ShoppingBag,
                },
                {
                  label:
                    d.grossProfit !== undefined
                      ? "مجمل الربح"
                      : "إجمالي المرتجعات",
                  value: fm(d.grossProfit ?? d.returns),
                  icon: ChartNoAxesCombined,
                },
                {
                  label: "منتجات منخفضة المخزون",
                  value: d.lowStock ?? "—",
                  icon: Boxes,
                },
              ].map((s, i) => (
                <section
                  className={`stat-card ${i === 0 ? "featured" : ""}`}
                  key={s.label}
                >
                  <div className="stat-top">
                    <span>{s.label}</span>
                    <s.icon size={19} />
                  </div>
                  <strong>{s.value}</strong>
                  <small>
                    {i === 3 ? "تابع مستويات المخزون" : "خلال الفترة المحددة"}
                  </small>
                </section>
              ))}
            </div>
            <div className="dashboard-grid">
              <section className="panel chart">
                <div className="panel-title">
                  <div>
                    <h2>حركة المبيعات</h2>
                    <p>إجمالي الفواتير حسب اليوم</p>
                  </div>
                  <span className="legend">
                    <i />
                    المبيعات
                  </span>
                </div>
                {d.daily.length ? (
                  <ResponsiveContainer width="100%" height={290}>
                    <BarChart
                      data={d.daily}
                      margin={{ top: 20, left: 10, right: 10, bottom: 10 }}
                    >
                      <CartesianGrid vertical={false} stroke="#ededed" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip formatter={(v: any) => fm(v)} />
                      <Bar
                        dataKey="sales"
                        fill="#c5a24a"
                        radius={[5, 5, 0, 0]}
                        maxBarSize={36}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <Empty />
                )}
              </section>
              <section className="panel summary">
                <div className="panel-title">
                  <h2>ملخص الفترة</h2>
                </div>
                {[
                  ["إجمالي المبيعات شامل الضريبة", d.totalSalesWithTax],
                  ["صافي المبيعات قبل الضريبة", d.netSales],
                  ["الخصومات", d.discounts],
                  ["المرتجعات", d.returns],
                  ["الضريبة", d.tax],
                  ...(d.expenses !== undefined
                    ? [
                        ["المصروفات", d.expenses],
                        [
                          "فروق تقييم مرتجعات المشتريات",
                          d.purchaseReturnVariance ?? "0",
                        ],
                        ["تكلفة شطب التالف", d.stockDamageCost ?? "0"],
                        ["صافي الربح", d.netProfit],
                      ]
                    : []),
                ].map(([label, value]) => (
                  <div className="summary-row" key={label}>
                    <span>{label}</span>
                    <strong>{fm(value)}</strong>
                  </div>
                ))}
                <p className="note">
                  التقارير تعتمد على أسعار وتكلفة كل عملية وقت تسجيلها.
                </p>
              </section>
              {d.cashiers?.length > 0 && (
                <section className="panel summary cashier-performance">
                  <div className="panel-title">
                    <div>
                      <h2>أداء الكاشير</h2>
                      <p>الفواتير والمبيعات بدون الضريبة خلال الفترة</p>
                    </div>
                  </div>
                  <div className="cashier-performance-head">
                    <span>الكاشير</span><span>الفواتير</span><span>المبيعات بدون الضريبة</span>
                  </div>
                  {d.cashiers.map((cashier: any) => (
                    <div className="cashier-performance-row" key={cashier.id}>
                      <span>{cashier.name} <small dir="ltr">{cashier.sellerCode}</small></span>
                      <strong>{cashier.invoices}</strong>
                      <strong>{fm(cashier.netSales)}</strong>
                    </div>
                  ))}
                </section>
              )}
            </div>
            <section className="quick-grid">
              {[
                {
                  to: "/pos",
                  title: "بيع جديد",
                  sub: "افتح نقطة البيع وابدأ المسح",
                  icon: ScanBarcode,
                  p: "pos.access",
                },
                {
                  to: "/products",
                  title: "كتالوج المنتجات",
                  sub: "المقاسات والألوان والباركود",
                  icon: ShoppingBag,
                  p: "products.view",
                },
                {
                  to: "/inventory",
                  title: "متابعة المخزون",
                  sub: "الأرصدة والحركات والتسويات",
                  icon: Boxes,
                  p: "inventory.view",
                },
              ]
                .filter((x) => user.permissions.includes(x.p))
                .map((x) => (
                  <Link className="quick-card" key={x.to} to={x.to}>
                    <div className="quick-icon">
                      <x.icon size={22} />
                    </div>
                    <div>
                      <h3>{x.title}</h3>
                      <p>{x.sub}</p>
                    </div>
                    <ArrowUpLeft size={18} />
                  </Link>
                ))}
            </section>
          </>
        )
      )}
    </>
  );
}
