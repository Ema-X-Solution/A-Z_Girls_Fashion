import { Pagination } from "../../components/application/Pagination";
import { TableSkeleton } from "../../components/application/Skeleton";
import { usePagination } from "../../hooks/usePagination";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { readableError } from "../../app/notifications";
import { api, patch } from "../../api";
import { Button } from "../../components/ui/button";
import { Field, ErrorMessage } from "../shared/Controls";
import { formatDate } from "../../i18n";
export function LoyaltySettings() {
  const client = useQueryClient(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: ["loyalty-settings"],
    queryFn: () => api("/loyalty/settings"),
  });
  if (query.isLoading) return <p>جارٍ تحميل إعدادات الولاء…</p>;
  if (query.error) return <ErrorMessage message={query.error.message} />;
  const data = query.data?.data;
  if (!data) return null;
  return (
    <section className="panel settings-panel">
      <h2>برنامج نقاط الولاء</h2>
      <p className="note">
        النقاط تُكتسب على الصافي قبل الضريبة بعد الخصومات. تغيير القواعد يخص
        العمليات الجديدة. النقاط المستعادة تحتفظ بصلاحيتها الأصلية، والمرتجعات
        تعكس النقاط المكتسبة.
      </p>
      <form
        key={query.dataUpdatedAt}
        className="entry-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await patch("/loyalty/settings", {
              enabled: form.get("enabled") === "on",
              spendPerPoint: String(form.get("spendPerPoint")),
              pointValue: String(form.get("pointValue")),
              expiryDays: Number(form.get("expiryDays")),
              maxRedeemPercent: Number(form.get("maxRedeemPercent")),
              minimumRedeemPoints: Number(form.get("minimumRedeemPoints")),
            });
            await client.invalidateQueries();
          } catch (e) {
            setError(readableError(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          <input type="checkbox" name="enabled" defaultChecked={data.enabled} />{" "}
          تفعيل برنامج الولاء
        </label>
        <div className="form-grid">
          {[
            [
              "spendPerPoint",
              "مبلغ الشراء لكل نقطة (EGP)",
              1,
              "0.01",
              undefined,
            ],
            [
              "pointValue",
              "قيمة النقطة عند الاستبدال (EGP)",
              0.01,
              "0.01",
              100,
            ],
            ["expiryDays", "صلاحية النقاط بالأيام", 1, "1", 3650],
            [
              "maxRedeemPercent",
              "أقصى نسبة استبدال من الفاتورة (%)",
              1,
              "1",
              90,
            ],
            ["minimumRedeemPoints", "أقل عدد نقاط للاستبدال", 1, "1", 1000000],
          ].map(([key, label, min, step, max]) => (
            <Field key={String(key)} label={String(label)}>
              {(id) => (
                <input
                  id={id}
                  name={String(key)}
                  required
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  defaultValue={Number(data[String(key)]).toFixed(
                    step === "0.01" ? 2 : 0,
                  )}
                />
              )}
            </Field>
          ))}
        </div>
        <ErrorMessage message={error} />
        <Button disabled={busy}>حفظ إعدادات الولاء</Button>
      </form>
    </section>
  );
}
const kinds: Record<string, string> = {
  EARN: "اكتساب",
  REDEEM: "استبدال",
  REVERSE: "إلغاء بسبب مرتجع",
  RESTORE: "استعادة بسبب مرتجع",
  EXPIRE: "انتهاء صلاحية",
};
export function CustomerLoyalty({ customerId }: { customerId: string }) {
  const paging = usePagination(customerId,true,"local");
  const query = useQuery({
    queryKey: ["customer-loyalty", customerId, paging.page, paging.pageSize],
    queryFn: ({signal}) => api(`/customers/${customerId}/loyalty?${paging.query}`,{signal}),
  });
  if (query.isLoading) return <TableSkeleton columns={3} />;
  if (query.error) return <ErrorMessage message={query.error.message} />;
  const data = query.data?.data;
  if (!data) return null;
  return (
    <section>
      <h3>نقاط الولاء</h3>
      <p>
        المتاح للاستبدال: <strong>{data.available}</strong> نقطة{" "}
        {data.debt > 0 &&
          ` • نقاط مستحقة بسبب مرتجعات: ${data.debt} (تُسوّى من الاكتساب أو الاستعادة التالية)`}
      </p>
      <p className="note">
        الرصيد يستبعد النقاط المنتهية. لا تُحتسب نقاط بأثر رجعي للفواتير السابقة.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>الحركة</th>
              <th>النقاط</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((entry: any) => (
              <tr key={entry.id}>
                <td>{formatDate(entry.createdAt)}</td>
                <td>{kinds[entry.kind] ?? entry.kind}</td>
                <td dir="ltr">
                  {entry.points > 0 ? "+" : ""}
                  {entry.points}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.total && <p>لا توجد حركات نقاط مسجلة.</p>}
      <Pagination page={paging.page} pageSize={paging.pageSize} onPageChange={paging.setPage} onPageSizeChange={paging.setPageSize} total={data.total} length={data.entries.length} disabled={query.isFetching} />
    </section>
  );
}
