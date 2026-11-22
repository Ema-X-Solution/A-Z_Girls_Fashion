import { readableError } from "../../app/notifications";
import { ApiError } from "../../api";
import { displayLocale } from "../../i18n";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, patch } from "../../api";
import { Header, Modal, Field, ErrorMessage } from "../shared/Controls";
import { Button } from "../../components/ui/button";
import { useDebouncedSearch } from "../../hooks/useDebouncedSearch";
const localDate = (date: string) => {
  const d = new Date(date);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export function Promotions() {
  const client = useQueryClient(),
    [draft, setDraft] = useState<any>(null),
    [scope, setScope] = useState("all"),
    [q, setQ] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const { debounced: debouncedQ, searchPending } = useDebouncedSearch(q);
  const campaigns = useQuery({
    queryKey: ["promotions"],
    queryFn: () => api("/promotions"),
  });
  const products = useQuery({
    queryKey: ["promotion-products", debouncedQ],
    queryFn: ({ signal }) =>
      api(`/products?limit=100&q=${encodeURIComponent(debouncedQ)}`, {
        signal,
      }),
    enabled: !!draft && !searchPending,
  });
  const change = (key: string, value: any) =>
    setDraft((old: any) => ({ ...old, [key]: value }));
  function edit(row?: any) {
    setError("");
    setScope(row?.productIds.length ? "selected" : "all");
    setDraft(
      row
        ? {
            ...row,
            startsAt: localDate(row.startsAt),
            endsAt: localDate(row.endsAt),
          }
        : {
            name: "",
            type: "BUY_X_GET_Y",
            buyQuantity: 2,
            getQuantity: 1,
            percent: "10",
            productIds: [],
            active: true,
            startsAt: localDate(new Date().toISOString()),
            endsAt: localDate(
              new Date(Date.now() + 7 * 86400000).toISOString(),
            ),
          },
    );
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      if (scope === "selected" && !draft.productIds.length)
        throw new Error("اختار منتجًا واحدًا على الأقل أو حدد كل المنتجات.");
      if (
        !draft.startsAt ||
        !draft.endsAt ||
        !Number.isFinite(Date.parse(draft.startsAt)) ||
        !Number.isFinite(Date.parse(draft.endsAt))
      )
        throw new Error("حدد تاريخ بداية ونهاية صحيحين للعرض.");
      if (new Date(draft.endsAt) <= new Date(draft.startsAt))
        throw new Error("تاريخ نهاية العرض يجب أن يكون بعد تاريخ البداية.");
      const body = {
        ...draft,
        productIds: scope === "all" ? [] : draft.productIds,
        percent: draft.type === "PERCENT" ? String(draft.percent) : "0",
        buyQuantity: Number(draft.buyQuantity),
        getQuantity: Number(draft.getQuantity),
        startsAt: new Date(draft.startsAt).toISOString(),
        endsAt: new Date(draft.endsAt).toISOString(),
      };
      if (draft.id) await patch(`/promotions/${draft.id}`, body);
      else await post("/promotions", body);
      await client.invalidateQueries();
      setDraft(null);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? readableError(e)
          : e instanceof Error
            ? e.message
            : "تعذر حفظ العرض",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Header
        title="العروض التلقائية"
        subtitle="خصومات مجدولة على كل المنتجات أو منتجات محددة."
      >
        <Button onClick={() => edit()}>إضافة عرض</Button>
      </Header>
      <p className="notice">
        يُطبق عرض تلقائي واحد بأعلى قيمة خصم، ثم الخصومات اليدوية على المبلغ
        المتبقي. عروض الهدية تتطلب إرجاع جميع أصناف العرض معًا.
      </p>
      <ErrorMessage
        message={
          campaigns.error instanceof Error
            ? campaigns.error.message
            : !draft
              ? error
              : ""
        }
      />
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              {["العرض", "النوع", "النطاق", "المدة", "الحالة", "الإجراءات"].map(
                (t) => (
                  <th key={t}>{t}</th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {campaigns.data?.data.map((r: any) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>
                  {r.type === "PERCENT"
                    ? `خصم ${r.percent}%`
                    : `اشتري ${r.buyQuantity} وخد ${r.getQuantity} هدية (الأقل سعرًا)`}
                </td>
                <td>
                  {r.productIds.length
                    ? `${r.productIds.length} منتجات`
                    : "كل المنتجات"}
                </td>
                <td>
                  {new Date(r.startsAt).toLocaleDateString(displayLocale)} —{" "}
                  {new Date(r.endsAt).toLocaleDateString(displayLocale)}
                </td>
                <td>
                  {!r.active
                    ? "متوقف"
                    : new Date(r.endsAt) <= new Date()
                      ? "منتهي"
                      : new Date(r.startsAt) > new Date()
                        ? "مجدول"
                        : "نشط"}
                </td>
                <td>
                  <Button variant="outline" onClick={() => edit(r)}>
                    تعديل العرض
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!campaigns.data?.data.length && (
          <p className="empty">
            {campaigns.isLoading
              ? "جارٍ التحميل..."
              : "لا توجد عروض. أضف عرضًا لتطبيقه تلقائيًا في نقطة البيع."}
          </p>
        )}
      </section>
      <Modal
        title={draft?.id ? "تعديل العرض" : "إضافة عرض"}
        open={!!draft}
        close={() => {
          if (!busy) setDraft(null);
        }}
      >
        {draft && (
          <form
            className="promotion-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <ErrorMessage message={error} />
            <Field label="اسم العرض">
              {(id) => (
                <input
                  id={id}
                  value={draft.name}
                  required
                  minLength={3}
                  maxLength={200}
                  onChange={(e) => change("name", e.target.value)}
                />
              )}
            </Field>
            <Field label="نوع العرض">
              {(id) => (
                <select
                  id={id}
                  value={draft.type}
                  onChange={(e) => change("type", e.target.value)}
                >
                  <option value="BUY_X_GET_Y">اشتري عدد وخد عدد هدية</option>
                  <option value="PERCENT">خصم بنسبة مئوية</option>
                </select>
              )}
            </Field>
            {draft.type === "PERCENT" ? (
              <Field label="نسبة خصم العرض">
                {(id) => (
                  <input
                    id={id}
                    type="number"
                    min="0.01"
                    max="100"
                    step="0.01"
                    value={draft.percent}
                    required
                    onChange={(e) => change("percent", e.target.value)}
                  />
                )}
              </Field>
            ) : (
              <div className="payment-grid">
                <Field label="عدد القطع المدفوعة">
                  {(id) => (
                    <input
                      id={id}
                      type="number"
                      min="1"
                      max="50"
                      value={draft.buyQuantity}
                      required
                      onChange={(e) => change("buyQuantity", e.target.value)}
                    />
                  )}
                </Field>
                <Field label="عدد القطع الهدية">
                  {(id) => (
                    <input
                      id={id}
                      type="number"
                      min="1"
                      max="50"
                      value={draft.getQuantity}
                      required
                      onChange={(e) => change("getQuantity", e.target.value)}
                    />
                  )}
                </Field>
              </div>
            )}
            <div className="payment-grid">
              <Field label="بداية العرض">
                {(id) => (
                  <input
                    id={id}
                    type="datetime-local"
                    required
                    value={draft.startsAt}
                    onChange={(e) => change("startsAt", e.target.value)}
                  />
                )}
              </Field>
              <Field label="نهاية العرض">
                {(id) => (
                  <input
                    id={id}
                    type="datetime-local"
                    required
                    value={draft.endsAt}
                    onChange={(e) => change("endsAt", e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Field label="المنتجات المشمولة">
              {(id) => (
                <select
                  id={id}
                  value={scope}
                  onChange={(e) => setScope(e.target.value)}
                >
                  <option value="all">كل المنتجات</option>
                  <option value="selected">منتجات محددة</option>
                </select>
              )}
            </Field>
            {scope === "selected" && (
              <>
                <Field label="بحث منتجات العرض">
                  {(id) => (
                    <input
                      id={id}
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                    />
                  )}
                </Field>
                <p>
                  تم اختيار {draft.productIds.length} منتجات بكل مقاساتها
                  وألوانها.
                </p>
                <div
                  style={{
                    maxHeight: 220,
                    overflow: "auto",
                    padding: 12,
                    border: "1px solid #eee",
                    borderRadius: 8,
                  }}
                >
                  {products.data?.data.map((p: any) => (
                    <label
                      key={p.id}
                      style={{ display: "flex", gap: 8, padding: 8 }}
                    >
                      <input
                        type="checkbox"
                        checked={draft.productIds.includes(p.id)}
                        disabled={searchPending || products.isFetching}
                        onChange={(e) =>
                          change(
                            "productIds",
                            e.target.checked
                              ? [...draft.productIds, p.id]
                              : draft.productIds.filter(
                                  (id: string) => id !== p.id,
                                ),
                          )
                        }
                      />
                      {p.nameAr} — {p.sku}
                    </label>
                  ))}
                </div>
              </>
            )}
            <label style={{ display: "flex", gap: 8, margin: "18px 0" }}>
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => change("active", e.target.checked)}
              />
              تفعيل العرض في الفترة المحددة
            </label>
            <Button disabled={busy}>
              {busy ? "جارٍ الحفظ..." : "حفظ العرض"}
            </Button>
          </form>
        )}
      </Modal>
    </>
  );
                  }
