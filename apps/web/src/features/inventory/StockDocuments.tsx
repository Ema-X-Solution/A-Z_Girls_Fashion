import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, useSession } from "../../api";
import { Button } from "../../components/ui/button";
import { Field, Modal, ErrorMessage } from "../shared/Controls";
import { formatDate, formatMoney } from "../../i18n";
import { useDebouncedSearch } from "../../hooks/useDebouncedSearch";
import { arabicFormValidation } from "../../components/application/arabicFormValidation";
const labels: Record<string, string> = {
  TRANSFER: "تحويل مباشر",
  DAMAGE: "شطب تالف",
  ADJUSTMENT: "تسوية",
};
type Line = { variantId: string; quantity: number; cost: string };
export function StockDocuments() {
  const client = useQueryClient(),
    user = useSession((s) => s.user)!;
  const canPost = user.permissions.includes("inventory.adjust"),
    costs = user.permissions.includes("reports.profit");
  const [offset, setOffset] = useState(0),
    [filter, setFilter] = useState(""),
    [draft, setDraft] = useState<any>(null),
    [selected, setSelected] = useState<any>(null),
    [locationOpen, setLocationOpen] = useState(false),
    [q, setQ] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const { debounced: debouncedQ, searchPending } = useDebouncedSearch(q);
  const query = useQuery({
    queryKey: ["stock-documents", offset, filter],
    queryFn: () =>
      api(
        `/inventory/documents?offset=${offset}${filter ? `&type=${filter}` : ""}`,
      ),
  });
  const locations = useQuery({
    queryKey: ["stock-document-locations"],
    queryFn: () => api("/locations"),
  });
  const products = useQuery({
    queryKey: ["stock-document-products", debouncedQ],
    queryFn: ({ signal }) =>
      api(`/products?limit=100&q=${encodeURIComponent(debouncedQ)}`, {
        signal,
      }),
    enabled: !!draft && !searchPending,
  });
  const allLocations = locations.data?.data ?? [];
  const variants = (products.data?.data ?? []).flatMap((p: any) =>
    p.variants.map((v: any) => ({ ...v, name: p.nameAr })),
  );
  const locationName = (id: string) =>
    allLocations.find((l: any) => l.id === id)?.name ?? "—";
  const change = (key: string, value: any) =>
    setDraft((d: any) => ({ ...d, [key]: value }));
  const lineChange = (index: number, key: keyof Line, value: any) =>
    setDraft((d: any) => ({
      ...d,
      items: d.items.map((line: Line, i: number) =>
        i === index ? { ...line, [key]: value } : line,
      ),
    }));
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await post(
        "/inventory/documents",
        {
          type: draft.type,
          sourceId: draft.sourceId,
          ...(draft.type === "TRANSFER"
            ? { destinationId: draft.destinationId }
            : {}),
          reason: draft.reason,
          items: draft.items.map((i: Line) => ({
            variantId: i.variantId,
            quantity: i.quantity,
            ...(draft.type === "ADJUSTMENT" && i.quantity > 0 && i.cost !== ""
              ? { cost: i.cost }
              : {}),
          })),
        },
        crypto.randomUUID(),
      );
      await client.invalidateQueries();
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر ترحيل المستند");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="toolbar">
        <select
          aria-label="نوع مستند المخزون"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">جميع المستندات</option>
          {Object.entries(labels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {canPost && (
          <div className="head-actions">
            <Button
              variant="outline"
              onClick={() => {
                setError("");
                setLocationOpen(true);
              }}
            >
              إضافة مخزن
            </Button>
            <Button
              onClick={() => {
                setError("");
                setDraft({
                  type: "TRANSFER",
                  sourceId: allLocations[0]?.id ?? "",
                  destinationId: "",
                  reason: "",
                  items: [{ variantId: "", quantity: 1, cost: "" }],
                });
              }}
            >
              مستند جديد
            </Button>
          </div>
        )}
      </div>
      <p className="note">
        التحويل مباشر بين المخازن. شطب التالف يُخرج الكمية نهائيًا من المخزون
        ويظهر بتكلفته في التقارير. المستند المرحّل محفوظ ولا يُعدّل.
      </p>
      {query.error ? (
        <ErrorMessage message={query.error.message} />
      ) : query.isLoading ? (
        <p>جارٍ التحميل…</p>
      ) : !query.data?.data.length ? (
        <p className="empty">لا توجد مستندات مخزون.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>المستند</th>
                <th>التاريخ</th>
                <th>النوع</th>
                <th>المصدر</th>
                <th>الوجهة</th>
                <th>الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {query.data.data.map((doc: any) => (
                <tr key={doc.id}>
                  <td>STK-{doc.number}</td>
                  <td>{formatDate(doc.createdAt)}</td>
                  <td>{labels[doc.type]}</td>
                  <td>{locationName(doc.sourceId)}</td>
                  <td>{locationName(doc.destinationId)}</td>
                  <td>
                    <Button variant="outline" onClick={() => setSelected(doc)}>
                      عرض المستند
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="pager">
        <span>{query.data?.total ?? 0} مستند</span>
        <Button
          variant="outline"
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 30))}
        >
          السابق
        </Button>
        <Button
          variant="outline"
          disabled={
            offset + (query.data?.data.length ?? 0) >= (query.data?.total ?? 0)
          }
          onClick={() => setOffset(offset + 30)}
        >
          التالي
        </Button>
      </div>
      <Modal
        title="مستند مخزون جديد"
        open={!!draft}
        close={() => {
          if (!busy) setDraft(null);
        }}
      >
        {draft && (
          <form
          {...arabicFormValidation()}
            className="entry-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="form-grid">
              <Field label="نوع العملية">
                {(id) => (
                  <select
                    id={id}
                    value={draft.type}
                    disabled={busy}
                    onChange={(e) => change("type", e.target.value)}
                  >
                    {Object.entries(labels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="المخزن المصدر">
                {(id) => (
                  <select
                    required
                    id={id}
                    value={draft.sourceId}
                    onChange={(e) => change("sourceId", e.target.value)}
                  >
                    <option value="">اختر المخزن</option>
                    {allLocations.map((l: any) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              {draft.type === "TRANSFER" && (
                <Field label="المخزن الوجهة">
                  {(id) => (
                    <select
                      required
                      id={id}
                      value={draft.destinationId}
                      onChange={(e) => change("destinationId", e.target.value)}
                    >
                      <option value="">اختر الوجهة</option>
                      {allLocations
                        .filter((l: any) => l.id !== draft.sourceId)
                        .map((l: any) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                    </select>
                  )}
                </Field>
              )}
            </div>
            <Field label="بحث أصناف المستند">
              {(id) => (
                <input
                  id={id}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="اسم المنتج أو SKU"
                />
              )}
            </Field>
            {products.error && (
              <ErrorMessage message={products.error.message} />
            )}
            {draft.items.map((line: Line, index: number) => (
              <div className="form-grid" key={index}>
                <Field label={`الصنف ${index + 1}`}>
                  {(id) => (
                    <select
                      required
                      id={id}
                      value={line.variantId}
                      disabled={searchPending || products.isFetching}
                      onChange={(e) =>
                        lineChange(index, "variantId", e.target.value)
                      }
                    >
                      <option value="">اختر الصنف</option>
                      {line.variantId &&
                        !variants.some((v: any) => v.id === line.variantId) && (
                          <option value={line.variantId}>صنف محدد سابقًا</option>
                        )}
                      {variants.map((v: any) => (
                        <option value={v.id} key={v.id}>
                          {v.name} • {v.sku}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field
                  label={
                    draft.type === "ADJUSTMENT"
                      ? `فرق الكمية ${index + 1} (+/-)`
                      : `الكمية ${index + 1}`
                  }
                >
                  {(id) => (
                    <input
                      required
                      id={id}
                      type="number"
                      step="1"
                      min={draft.type === "ADJUSTMENT" ? -100000 : 1}
                      max="100000"
                      value={line.quantity}
                      onChange={(e) =>
                        lineChange(index, "quantity", Number(e.target.value))
                      }
                    />
                  )}
                </Field>
                {costs && draft.type === "ADJUSTMENT" && line.quantity > 0 && (
                  <Field label={`تكلفة الوحدة ${index + 1} (اختياري)`}>
                    {(id) => (
                      <input
                        id={id}
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.cost}
                        onChange={(e) =>
                          lineChange(index, "cost", e.target.value)
                        }
                      />
                    )}
                  </Field>
                )}
                {draft.items.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      change(
                        "items",
                        draft.items.filter((_: Line, i: number) => i !== index),
                      )
                    }
                  >
                    حذف الصنف {index + 1}
                  </Button>
                )}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={draft.items.length >= 200}
              onClick={() =>
                change("items", [
                  ...draft.items,
                  { variantId: "", quantity: 1, cost: "" },
                ])
              }
            >
              إضافة صنف للمستند
            </Button>
            <Field label="سبب العملية">
              {(id) => (
                <textarea
                  id={id}
                  required
                  minLength={3}
                  maxLength={1000}
                  value={draft.reason}
                  onChange={(e) => change("reason", e.target.value)}
                />
              )}
            </Field>
            <ErrorMessage message={error} />
            <Button disabled={busy || searchPending || products.isFetching}>
              ترحيل المستند
            </Button>
          </form>
        )}
      </Modal>
      <Modal
        title={`مستند STK-${selected?.number ?? ""}`}
        open={!!selected}
        close={() => setSelected(null)}
      >
        {selected && (
          <>
            <p>
              {labels[selected.type]} • {formatDate(selected.createdAt)}
            </p>
            <p>
              {locationName(selected.sourceId)}{" "}
              {selected.destinationId
                ? `← ${locationName(selected.destinationId)}`
                : ""}
            </p>
            <p>{selected.reason}</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>الصنف</th>
                    <th>الكمية</th>
                    {costs && <th>تكلفة الوحدة</th>}
                  </tr>
                </thead>
                <tbody>
                  {selected.items.map((line: any) => (
                    <tr key={line.id}>
                      <td>{line.sku}</td>
                      <td>{line.name}</td>
                      <td>{line.quantity}</td>
                      {costs && <td>{formatMoney(line.unitCost)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {costs && (
              <p>قيمة المستند بالتكلفة: {formatMoney(selected.totalCost)}</p>
            )}
            <p className="note">المرجع: {selected.id}</p>
          </>
        )}
      </Modal>
      <Modal
        title="إضافة مخزن"
        open={locationOpen}
        close={() => {
          if (!busy) setLocationOpen(false);
        }}
      >
        <form
          {...arabicFormValidation()}
          className="entry-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              await post("/inventory/locations", {
                name: form.get("name"),
                branchId: form.get("branchId"),
              });
              await client.invalidateQueries();
              setLocationOpen(false);
            } catch (e) {
              setError(e instanceof Error ? e.message : "تعذر إضافة المخزن");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="اسم المخزن">
            {(id) => (
              <input
                id={id}
                required
                name="name"
                minLength={2}
                maxLength={200}
              />
            )}
          </Field>
          <Field label="الفرع">
            {(id) => (
              <select id={id} required name="branchId">
                {allLocations
                  .filter(
                    (l: any, i: number, rows: any[]) =>
                      rows.findIndex((v) => v.branchId === l.branchId) === i,
                  )
                  .map((l: any) => (
                    <option key={l.branchId} value={l.branchId}>
                      {l.branch?.name ?? l.name}
                    </option>
                  ))}
              </select>
            )}
          </Field>
          <ErrorMessage message={error} />
          <Button disabled={busy}>حفظ المخزن</Button>
        </form>
      </Modal>
    </div>
  );
            }
