import { EntitySelect } from "../../components/application/EntitySelect";
import { SmartSelect } from "../../components/application/SmartSelect";
import { Pagination } from "../../components/application/Pagination";
import { TableSkeleton } from "../../components/application/Skeleton";
import { usePagination } from "../../hooks/usePagination";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, useSession } from "../../api";
import { Button } from "../../components/ui/button";
import { Field, Modal, ErrorMessage } from "../shared/Controls";
import { formatDate, formatMoney } from "../../i18n";
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
  const [filter, setFilter] = useState(""),
    [draft, setDraft] = useState<any>(null),
    [selected, setSelected] = useState<any>(null),
    [locationOpen, setLocationOpen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const paging = usePagination(filter);
  const query = useQuery({
    queryKey: ["stock-documents", paging.page, paging.pageSize, filter],
    queryFn: ({ signal }) =>
      api(
        `/inventory/documents?${paging.query}${filter ? `&type=${filter}` : ""}`,
        { signal },
      ),
  });
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
                  sourceId: "",
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
        <TableSkeleton columns={6} label="جارٍ تحميل مستندات المخزون" />
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
                  <td>{doc.sourceName ?? doc.sourceId}</td>
                  <td>{doc.destinationName ?? "—"}</td>
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
      <Pagination
        page={paging.page}
        pageSize={paging.pageSize}
        onPageChange={paging.setPage}
        onPageSizeChange={paging.setPageSize}
        total={query.data?.total ?? 0}
        length={query.data?.data.length ?? 0}
        disabled={query.isFetching}
      />
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
                  <EntitySelect
                    kind="locations"
                    name="sourceId"
                    id={id}
                    label="المخزن المصدر"
                    value={draft.sourceId}
                    onChange={(value) => change("sourceId", value)}
                  />
                )}
              </Field>
              {draft.type === "TRANSFER" && (
                <Field label="المخزن الوجهة">
                  {(id) => (
                    <EntitySelect
                      kind="locations"
                      name="destinationId"
                      id={id}
                      label="المخزن الوجهة"
                      value={draft.destinationId}
                      onChange={(value) => change("destinationId", value)}
                      params={`exclude=${draft.sourceId}`}
                    />
                  )}
                </Field>
              )}
            </div>
            {draft.items.map((line: Line, index: number) => (
              <div className="form-grid" key={index}>
                <Field label={`الصنف ${index + 1}`}>
                  {(id) => (
                    <SmartSelect
                      id={id}
                      name={`variant-${index}`}
                      label={`الصنف ${index + 1}`}
                      searchLabel={
                        index === 0 ? "بحث أصناف المستند" : undefined
                      }
                      value={line.variantId}
                      endpoint="/variant-options"
                      optionLabel={(v) => `${v.productNameAr} • ${v.sku}`}
                      onChange={(v) => lineChange(index, "variantId", v.id)}
                    />
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
            <Button disabled={busy}>ترحيل المستند</Button>
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
              {selected.sourceName ?? selected.sourceId}{" "}
              {selected.destinationId
                ? `← ${selected.destinationName ?? selected.destinationId}`
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
              <EntitySelect
                kind="branches"
                defaultFirst
                name="branchId"
                id={id}
                label="الفرع"
              />
            )}
          </Field>
          <ErrorMessage message={error} />
          <Button disabled={busy}>حفظ المخزن</Button>
        </form>
      </Modal>
    </div>
  );
              }
