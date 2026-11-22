import { useState } from "react";
import { Header, Modal, ErrorMessage } from "../shared/Controls";
import {
  Grid,
  useRows,
  useTask,
  save,
  Pagination,
  FormField,
  PageState,
  when,
  allowed,
  type Row,
} from "./Tools";
import { useDebouncedSearch } from "../../hooks/useDebouncedSearch";
import "./management.css";
export function AdvancedInventory() {
  const [tab, setTab] = useState("shipments"),
    [offset, setOffset] = useState(0),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState<Row | null>(null),
    [search, setSearch] = useState(""),
    [lines, setLines] = useState([{ variantId: "", quantity: 1 }]);
  const { debounced, searchPending } = useDebouncedSearch(search),
    task = useTask(),
    query = useRows(`/inventory/${tab}?offset=${offset}`),
    locations = useRows("/locations"),
    products = useRows(
      `/products?q=${encodeURIComponent(debounced)}&limit=100`,
      !searchPending,
    );
  const variants: Row[] =
    products.data?.data.flatMap((p: Row) =>
      p.variants.map((v: Row) => ({
        ...v,
        label: `${p.nameAr} • ${v.sku} • ${Object.values(v.options).join(" / ")}`,
      })),
    ) ?? [];
  const location = (id: string) =>
    locations.data?.data.find((l: Row) => l.id === id)?.name ?? id;
  return (
    <>
      <Header
        title="الشحن وحجر المخزون"
        subtitle="الشحنة تخصم من المصدر عند الشحن وتضاف للوجهة عند الاستلام. الحجر يمنع بيع القطعة حتى الإفراج أو الشطب."
      >
        {allowed("inventory.adjust") && (
          <button
            className="btn btn-primary"
            onClick={() => {
              setLines([{ variantId: "", quantity: 1 }]);
              setOpen(true);
            }}
          >
            {tab === "shipments" ? "شحنة تحويل جديدة" : "حجر كمية"}
          </button>
        )}
      </Header>
      <ErrorMessage message={task.error} />
      <div className="management-tabs">
        {[
          ["shipments", "شحنات التحويل"],
          ["holds", "المخزون المحجور"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`btn ${tab === key ? "btn-primary" : "btn-outline"}`}
            onClick={() => {
              setTab(key!);
              setOffset(0);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <section className="panel management-card">
        <PageState query={query} />
        <Grid
          rows={query.data?.data ?? []}
          columns={
            tab === "shipments"
              ? [
                  { label: "التاريخ", render: (r) => when(r.createdAt) },
                  { label: "المصدر", render: (r) => location(r.sourceId) },
                  { label: "الوجهة", render: (r) => location(r.destinationId) },
                  {
                    label: "الحالة",
                    render: (r) =>
                      ({
                        SHIPPED: "مشحون",
                        PARTIAL: "مستلم جزئيًا",
                        RECEIVED: "مستلم بالكامل",
                      })[r.status as "SHIPPED"],
                  },
                  {
                    label: "المتبقي بالطريق",
                    render: (r) =>
                      r.items.reduce(
                        (n: number, i: Row) => n + i.quantity - i.received,
                        0,
                      ),
                  },
                  {
                    label: "الإجراءات",
                    render: (r) => (
                      <button
                        className="btn btn-outline"
                        onClick={() => setSelected(r)}
                      >
                        تفاصيل واستلام
                      </button>
                    ),
                  },
                ]
              : [
                  { label: "التاريخ", render: (r) => when(r.createdAt) },
                  { label: "المخزن", render: (r) => location(r.locationId) },
                  { label: "الصنف", render: (r) => r.variantLabel ?? `صنف غير متاح (${r.variantId})` },
                  { label: "السبب", render: (r) => r.reason },
                  {
                    label: "المتبقي",
                    render: (r) => r.quantity - r.released - r.disposed,
                  },
                  {
                    label: "الإجراءات",
                    render: (r) => (
                      <button
                        className="btn btn-outline"
                        onClick={() => setSelected(r)}
                      >
                        الإفراج أو الشطب
                      </button>
                    ),
                  },
                ]
          }
        />
        <Pagination
          offset={offset}
          onChange={setOffset}
          total={query.data?.total ?? 0}
        />
      </section>
      <Modal
        title={tab === "shipments" ? "شحن تحويل بين مخزنين" : "حجر بضاعة للفحص"}
        open={open}
        close={() => setOpen(false)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = Object.fromEntries(new FormData(e.currentTarget));
            const body =
              tab === "shipments"
                ? {
                    sourceId: f.sourceId,
                    destinationId: f.destinationId,
                    reason: f.reason,
                    items: lines,
                  }
                : {
                    locationId: f.sourceId,
                    variantId: lines[0]!.variantId,
                    quantity: lines[0]!.quantity,
                    reason: f.reason,
                  };
            void task.run(
              () => save(`/inventory/${tab}`, body),
              () => setOpen(false),
            );
          }}
        >
          <FormField label="المخزن المصدر">
            <select name="sourceId" required>
              <option value="">اختر...</option>
              {locations.data?.data.map((l: Row) => (
                <option key={l.id} value={l.id}>
                  {l.branch?.name} • {l.name}
                </option>
              ))}
            </select>
          </FormField>
          {tab === "shipments" && (
            <FormField label="المخزن المستلم">
              <select name="destinationId" required>
                <option value="">اختر...</option>
                {locations.data?.data.map((l: Row) => (
                  <option key={l.id} value={l.id}>
                    {l.branch?.name} • {l.name}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          <FormField label="بحث عن صنف بالاسم أو SKU">
            <input value={search} onChange={(e) => setSearch(e.target.value)} />
          </FormField>
          {lines.map((line, index) => (
            <div className="management-tools" key={index}>
              <FormField label="الصنف">
                <select
                  required
                  value={line.variantId}
                  onChange={(e) =>
                    setLines((rows) =>
                      rows.map((r, i) =>
                        i === index ? { ...r, variantId: e.target.value } : r,
                      ),
                    )
                  }
                >
                  <option value="">اختر...</option>
                  {line.variantId &&
                    !variants.some((v) => v.id === line.variantId) && (
                      <option value={line.variantId}>{line.variantId}</option>
                    )}
                  {!searchPending &&
                    variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                </select>
              </FormField>
              <FormField label="الكمية">
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={line.quantity}
                  onChange={(e) =>
                    setLines((rows) =>
                      rows.map((r, i) =>
                        i === index
                          ? { ...r, quantity: Number(e.target.value) }
                          : r,
                      ),
                    )
                  }
                />
              </FormField>
              {lines.length > 1 && (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() =>
                    setLines((rows) => rows.filter((_, i) => i !== index))
                  }
                >
                  إزالة السطر
                </button>
              )}
            </div>
          ))}
          {tab === "shipments" && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() =>
                setLines((v) => [...v, { variantId: "", quantity: 1 }])
              }
            >
              إضافة صنف
            </button>
          )}
          <FormField label="السبب">
            <textarea name="reason" required minLength={3} maxLength={1000} />
          </FormField>
          <button
            className="btn btn-primary"
            disabled={task.busy || searchPending}
          >
            {tab === "shipments" ? "شحن وخصم من المصدر" : "نقل إلى الحجر"}
          </button>
        </form>
      </Modal>
      <Modal
        title={
          tab === "shipments"
            ? "تفاصيل الشحنة واستلامها"
            : "معالجة المخزون المحجور"
        }
        open={!!selected}
        close={() => setSelected(null)}
      >
        {selected &&
          (tab === "shipments" ? (
            <>
              <p>
                {location(selected.sourceId)} ←{" "}
                {location(selected.destinationId)} • {selected.reason}
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = new FormData(e.currentTarget);
                  const items = selected.items
                    .map((i: Row) => ({
                      itemId: i.id,
                      quantity: Number(data.get(i.id)),
                    }))
                    .filter((i: Row) => i.quantity > 0);
                  void task.run(
                    () =>
                      save(`/inventory/shipments/${selected.id}/receive`, {
                        items,
                      }),
                    () => setSelected(null),
                  );
                }}
              >
                {selected.items.map((i: Row) => (
                  <FormField
                    key={i.id}
                    label={`${i.variantLabel ?? `صنف غير متاح (${i.variantId})`} • المشحون ${i.quantity} • المستلم ${i.received}`}
                  >
                    <input
                      name={i.id}
                      type="number"
                      min={0}
                      max={i.quantity - i.received}
                      step={1}
                      defaultValue={0}
                    />
                  </FormField>
                ))}
                {selected.status !== "RECEIVED" &&
                  (allowed("inventory.adjust") ||
                    allowed("purchases.receive")) && (
                    <button className="btn btn-primary" disabled={task.busy}>
                      اعتماد الكميات المستلمة
                    </button>
                  )}
              </form>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = Object.fromEntries(new FormData(e.currentTarget));
                void task.run(
                  () =>
                    save(`/inventory/holds/${selected.id}/resolve`, {
                      action: f.action,
                      quantity: Number(f.quantity),
                      reason: f.reason,
                    }),
                  () => setSelected(null),
                );
              }}
            >
              <p>
                المحجور {selected.quantity} • أفرج عنه {selected.released} • شُطب{" "}
                {selected.disposed}
              </p>
              <FormField label="الإجراء">
                <select name="action">
                  <option value="RELEASE">إعادة للمخزون القابل للبيع</option>
                  <option value="DISPOSE">
                    شطب نهائي واحتساب تكلفة التالف
                  </option>
                </select>
              </FormField>
              <FormField label="الكمية">
                <input
                  name="quantity"
                  type="number"
                  min={1}
                  max={
                    selected.quantity - selected.released - selected.disposed
                  }
                  required
                />
              </FormField>
              <FormField label="السبب">
                <textarea name="reason" required minLength={3} />
              </FormField>
              {allowed("inventory.adjust") && (
                <button className="btn btn-primary" disabled={task.busy}>
                  تسجيل المعالجة
                </button>
              )}
            </form>
          ))}
      </Modal>
    </>
  );
              }
