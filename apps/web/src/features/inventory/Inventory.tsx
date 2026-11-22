import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { patch, post } from "../../api";
import { formatDigits, ar, formatDate, formatMoney as fm } from "../../i18n";
import { Button } from "../../components/ui/button";
import { StockDocuments } from "./StockDocuments";
import { useDebouncedSearch } from "../../hooks/useDebouncedSearch";
import { useAction } from "../../app/notifications";
import { useData, useAllowed } from "../../hooks/useData";
import { Loading, ErrorState, Modal, Field, Header, Badge, Table, Pager } from "../../components/application/Primitives";
import { EntryForm, simple } from "../../components/application/EntryForm";
import { type Row } from "../../app/types";

export function Inventory() {
  const [tab, setTab] = useState("balances"),
    [offset, setOffset] = useState(0),
    [open, setOpen] = useState(false),
    [low, setLow] = useState(false),
    [locationFilter, setLocationFilter] = useState(""),
    [search, setSearch] = useState(""),
    { debounced: debouncedSearch, searchPending } = useDebouncedSearch(search),
    [detail, setDetail] = useState<Row | null>(null),
    path =
      tab === "balances"
        ? `/inventory?offset=${offset}${locationFilter ? `&locationId=${locationFilter}` : ""}${debouncedSearch ? `&q=${encodeURIComponent(debouncedSearch)}` : ""}`
        : tab === "movements"
          ? `/inventory/movements?offset=${offset}`
          : `/inventory/stock-counts?offset=${offset}`,
    query = useData(
      path,
      tab !== "documents",
      tab === "balances" ? searchPending : false,
    ),
    locations = useData("/locations"),
    products = useData("/products?limit=100"),
    action = useAction(),
    adjust = useAllowed("inventory.adjust"),
    count = useAllowed("inventory.count"),
    [selected, setSelected] = useState<Row | null>(null);
  return (
    <>
      <Header title={ar.inventory} subtitle="كل قطعة لها رصيد وحركة موثقة">
        {count && (
          <Button variant="outline" onClick={() => setSelected({ new: true })}>
            جرد جديد
          </Button>
        )}
        {adjust && (
          <Button onClick={() => setOpen(true)}>
            <Plus size={18} />
            تسوية المخزون
          </Button>
        )}
      </Header>
      <section className="panel">
        <div className="tabs">
          {[
            ["balances", "أرصدة المخزون"],
            ["movements", "سجل الحركات"],
            ["documents", "التحويلات والتالف والتسويات"],
            ...(count ? [["counts", "جلسات الجرد"]] : []),
          ].map(([k, label]) => (
            <button
              className={tab === k ? "active" : ""}
              key={k}
              onClick={() => {
                setTab(k!);
                setOffset(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "balances" && (
          <div
            className="toolbar"
            style={{
              display: "flex",
              gap: "1rem",
              flexWrap: "wrap",
              alignItems: "center",
              marginBottom: "1rem",
            }}
          >
            <div className="search" style={{ minWidth: "220px", flex: 1 }}>
              <Search size={18} />
              <input
                placeholder="ابحث بالاسم أو الباركود أو الكود..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setOffset(0);
                }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
                المخزن:
              </span>
              <select
                style={{
                  padding: "0.45rem 0.8rem",
                  borderRadius: "6px",
                  border: "1px solid var(--border)",
                  background: "var(--card-bg, inherit)",
                  color: "inherit",
                }}
                value={locationFilter}
                onChange={(e) => {
                  setLocationFilter(e.target.value);
                  setOffset(0);
                }}
              >
                <option value="">كل المخازن</option>
                {locations.data?.data?.map((l: Row) => (
                  <option key={l.id} value={l.id}>
                    {l.name} {l.branch?.name ? `(${l.branch.name})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <label
              className="checkbox"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                cursor: "pointer",
                margin: 0,
              }}
            >
              <input
                type="checkbox"
                checked={low}
                onChange={(e) => setLow(e.target.checked)}
              />
              منخفض المخزون فقط
            </label>
          </div>
        )}

        {tab === "documents" ? (
          <StockDocuments />
        ) : query.isLoading ? (
          <Loading />
        ) : query.error ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            <Table
              rows={(query.data?.data ?? []).filter(
                (r: Row) =>
                  tab !== "balances" ||
                  !low ||
                  r.quantity <= r.variant.minStock,
              )}
              columns={
                tab === "balances"
                  ? [
                      {
                        label: "المنتج",
                        render: (r) => (
                          <div>
                            <strong>{r.variant.product.nameAr}</strong>
                            <small>
                              {formatDigits(Object.values(r.variant.options).join(" / "))}
                            </small>
                          </div>
                        ),
                      },
                      {
                        label: ar.barcode,
                        render: (r) => <code>{r.variant.barcode}</code>,
                      },
                      { label: ar.location, render: (r) => r.location.name },
                      {
                        label: "المتاح",
                        render: (r) => (
                          <span
                            className={
                              r.quantity <= r.variant.minStock
                                ? "low-stock"
                                : ""
                            }
                          >
                            {r.quantity}
                          </span>
                        ),
                      },
                      {
                        label: "الحد الأدنى",
                        render: (r) => r.variant.minStock,
                      },
                      {
                        label: ar.actions,
                        render: (r) => (
                          <Button
                            variant="ghost"
                            onClick={() => setDetail(r)}
                          >
                            التفاصيل
                          </Button>
                        ),
                      },
                    ]
                  : tab === "movements"
                    ? [
                        {
                          label: ar.date,
                          render: (r) => formatDate(r.createdAt),
                        },
                        {
                          label: "المنتج",
                          render: (r) => r.variant.product.nameAr,
                        },
                        {
                          label: "الحركة",
                          render: (r) => <Badge value={r.type} />,
                        },
                        {
                          label: ar.quantity,
                          render: (r) => (
                            <b
                              className={
                                r.quantity < 0 ? "negative" : "positive"
                              }
                            >
                              {r.quantity > 0 ? "+" : ""}
                              {r.quantity}
                            </b>
                          ),
                        },
                        { label: ar.reason, render: (r) => r.reason },
                        {
                          label: "المرجع",
                          render: (r) => <code>{r.reference.slice(0, 8)}</code>,
                        },
                      ]
                    : [
                        { label: ar.date, render: (r) => formatDate(r.cutoff) },
                        {
                          label: ar.status,
                          render: (r) => <Badge value={r.status} />,
                        },
                        { label: "عدد الأصناف", render: (r) => r.items.length },
                        {
                          label: ar.actions,
                          render: (r) =>
                            r.status === "OPEN" ? (
                              <Button
                                variant="outline"
                                onClick={() => setSelected(r)}
                              >
                                فتح الجرد
                              </Button>
                            ) : (
                              <span className="muted-text">تم إغلاق الجرد</span>
                            ),
                        },
                      ]
              }
            />
            <Pager
              offset={offset}
              setOffset={setOffset}
              length={query.data?.data.length ?? 0}
            />
          </>
        )}
      </section>
      <Modal title="تسوية المخزون" open={open} onClose={() => setOpen(false)}>
        <EntryForm
          fields={[
            {
              key: "variantId",
              label: "المتغير",
              options:
                products.data?.data.flatMap((p: Row) =>
                  p.variants.map((v: Row) => ({
                    value: v.id,
                    label: `${p.nameAr} • ${v.sku}`,
                  })),
                ) ?? [],
            },
            {
              key: "locationId",
              label: ar.location,
              options:
                locations.data?.data.map((l: Row) => ({
                  value: l.id,
                  label: l.name,
                })) ?? [],
            },
            simple("quantity", "فرق الكمية (+ زيادة / - نقص)"),
            simple("reason", ar.reason),
          ]}
          busy={action.busy}
          submit={(body) =>
            void action.run(
              () =>
                post(
                  "/inventory/adjustments",
                  { ...body, quantity: Number(body.quantity) },
                  crypto.randomUUID(),
                ),
              () => setOpen(false),
            )
          }
        />
      </Modal>
      <Modal
        title={selected?.new ? "جلسة جرد جديدة" : "الجرد الفعلي"}
        open={!!selected}
        onClose={() => setSelected(null)}
      >
        {selected?.new ? (
          <>
            <p className="note">
              الجرد بلقطة ثابتة يحتاج إيقاف الحركة. في الجرد المستمر سجّل كل سطر
              فور عدّه بالخروج من حقل الكمية؛ تُضاف الحركات التالية لذلك التوقيت
              عند الاعتماد.
            </p>
            <EntryForm
              fields={[
                {
                  key: "locationId",
                  label: ar.location,
                  options:
                    locations.data?.data.map((l: Row) => ({
                      value: l.id,
                      label: l.name,
                    })) ?? [],
                },
                {
                  key: "mode",
                  label: "أسلوب الجرد",
                  options: [
                    { value: "CUTOFF", label: "لقطة ثابتة مع إيقاف الحركة" },
                    {
                      value: "CONTINUOUS",
                      label: "جرد مستمر مع تسوية الحركات اللاحقة",
                    },
                  ],
                },
              ]}
              busy={action.busy}
              submit={(body) =>
                void action.run(
                  () => post("/inventory/stock-counts", body),
                  () => setSelected(null),
                )
              }
            />
          </>
        ) : (
          selected && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const data = new FormData(e.currentTarget);
                void action.run(
                  async () => {
                    if (selected.mode !== "CONTINUOUS")
                      await patch(`/inventory/stock-counts/${selected.id}`, {
                        items: selected.items.map((i: Row) => ({
                          variantId: i.variantId,
                          actual: Number(data.get(i.variantId)),
                        })),
                      });
                    await post(
                      `/inventory/stock-counts/${selected.id}/approve`,
                      {},
                    );
                  },
                  () => setSelected(null),
                );
              }}
            >
              <p>لقطة المخزون: {formatDate(selected.cutoff)}</p>
              {selected.items.map((i: Row) => (
                <Field
                  key={i.variantId}
                  label={`${products.data?.data.flatMap((p: Row) => p.variants).find((v: Row) => v.id === i.variantId)?.sku ?? i.variantId} • المتوقع ${i.expected}`}
                >
                  <input
                    required
                    type="number"
                    min="0"
                    step="1"
                    name={i.variantId}
                    defaultValue={i.actual ?? ""}
                    onBlur={(e) => {
                      if (
                        selected.mode === "CONTINUOUS" &&
                        selected.status === "OPEN" &&
                        e.target.value !== ""
                      ) {
                        const actual = Number(e.target.value);
                        if (Number.isInteger(actual) && actual >= 0)
                          void action.run(
                            () =>
                              patch(`/inventory/stock-counts/${selected.id}`, {
                                items: [{ variantId: i.variantId, actual }],
                              }),
                            () =>
                              setSelected((current) =>
                                current
                                  ? {
                                      ...current,
                                      items: current.items.map((line: Row) =>
                                        line.variantId === i.variantId
                                          ? {
                                              ...line,
                                              actual,
                                              countedAt:
                                                new Date().toISOString(),
                                            }
                                          : line,
                                      ),
                                    }
                                  : current,
                              ),
                          );
                      }
                    }}
                    disabled={selected.status !== "OPEN"}
                  />
                </Field>
              ))}
              {adjust && selected.status === "OPEN" && (
                <Button disabled={action.busy}>حفظ واعتماد الجرد</Button>
              )}
              {selected.status === "OPEN" && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={action.busy}
                  onClick={() => {
                    if (window.confirm("إلغاء جلسة الجرد دون تغيير المخزون؟"))
                      void action.run(
                        () =>
                          post(
                            `/inventory/stock-counts/${selected.id}/cancel`,
                            {},
                            crypto.randomUUID(),
                          ),
                        () => setSelected(null),
                      );
                  }}
                >
                  إلغاء جلسة الجرد
                </Button>
              )}
            </form>
          )
        )}
      </Modal>
      <Modal
        title={`تفاصيل الصنف بالمخزن: ${detail?.variant?.product?.nameAr ?? ""}`}
        open={!!detail}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "0.75rem",
              }}
            >
              <div
                className="card"
                style={{
                  padding: "0.85rem",
                  border: "1px solid var(--border, #e2e8f0)",
                  borderRadius: "8px",
                  background: "var(--card-bg, #fff)",
                }}
              >
                <small className="muted-text">اسم المنتج</small>
                <div style={{ fontWeight: 600, fontSize: "1.05rem" }}>
                  {detail.variant?.product?.nameAr}
                </div>
                <small dir="ltr" className="muted-text">
                  {detail.variant?.sku}
                </small>
              </div>
              <div
                className="card"
                style={{
                  padding: "0.85rem",
                  border: "1px solid var(--border, #e2e8f0)",
                  borderRadius: "8px",
                  background: "var(--card-bg, #fff)",
                }}
              >
                <small className="muted-text">المخزن</small>
                <div style={{ fontWeight: 600, fontSize: "1.05rem" }}>
                  {detail.location?.name}
                </div>
                {detail.location?.branch?.name && (
                  <small className="muted-text">
                    الفرع: {detail.location.branch.name}
                  </small>
                )}
              </div>
              <div
                className="card"
                style={{
                  padding: "0.85rem",
                  border: "1px solid var(--border, #e2e8f0)",
                  borderRadius: "8px",
                  background: "var(--card-bg, #fff)",
                }}
              >
                <small className="muted-text">المقاس / اللون</small>
                <div style={{ fontWeight: 600 }}>
                  {formatDigits(Object.values(detail.variant?.options ?? {}).join(" / ")) ||
                    "بدون خيارات"}
                </div>
              </div>
              <div
                className="card"
                style={{
                  padding: "0.85rem",
                  border: "1px solid var(--border, #e2e8f0)",
                  borderRadius: "8px",
                  background: "var(--card-bg, #fff)",
                }}
              >
                <small className="muted-text">الباركود</small>
                <div>
                  <code>{detail.variant?.barcode}</code>
                </div>
              </div>
              <div
                className="card"
                style={{
                  padding: "0.85rem",
                  border: "1px solid var(--border, #e2e8f0)",
                  borderRadius: "8px",
                  background: "var(--card-bg, #fff)",
                }}
              >
                <small className="muted-text">الكمية المتاحة</small>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "1.3rem",
                    color:
                      detail.quantity <= detail.variant?.minStock
                        ? "#ef4444"
                        : "#10b981",
                  }}
                >
                  {detail.quantity} قطعة
                </div>
              </div>
              <div
                className="card"
                style={{
                  padding: "0.85rem",
                  border: "1px solid var(--border, #e2e8f0)",
                  borderRadius: "8px",
                  background: "var(--card-bg, #fff)",
                }}
              >
                <small className="muted-text">الحد الأدنى للطلب (ديناميكي)</small>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    marginTop: "0.3rem",
                  }}
                >
                  <input
                    type="number"
                    min="0"
                    key={`min-${detail.variant?.id}-${detail.variant?.minStock}`}
                    defaultValue={detail.variant?.minStock ?? 2}
                    id={`min-stock-input-${detail.variant?.id}`}
                    style={{
                      width: "65px",
                      padding: "0.2rem 0.4rem",
                      borderRadius: "4px",
                      border: "1px solid var(--border)",
                      fontWeight: 600,
                    }}
                  />
                  <Button
                    variant="outline"
                    type="button"
                    disabled={action.busy}
                    onClick={() => {
                      const el = document.getElementById(
                        `min-stock-input-${detail.variant?.id}`,
                      ) as HTMLInputElement;
                      if (el && el.value !== "") {
                        const val = Number(el.value);
                        void action.run(
                          () =>
                            patch(`/variants/${detail.variant?.id}`, {
                              minStock: val,
                            }),
                          () => {
                            setDetail((curr) =>
                              curr
                                ? {
                                    ...curr,
                                    variant: { ...curr.variant, minStock: val },
                                  }
                                : null,
                            );
                          },
                        );
                      }
                    }}
                  >
                    حفظ
                  </Button>
                </div>
              </div>
              <div
                className="card"
                style={{
                  padding: "0.85rem",
                  border: "1px solid var(--border, #e2e8f0)",
                  borderRadius: "8px",
                  background: "var(--card-bg, #fff)",
                }}
              >
                <small className="muted-text">سعر البيع</small>
                <div style={{ fontWeight: 600 }}>
                  {fm(detail.variant?.price)}
                </div>
              </div>
              {detail.averageCost !== undefined && (
                <div
                  className="card"
                  style={{
                    padding: "0.85rem",
                    border: "1px solid var(--border, #e2e8f0)",
                    borderRadius: "8px",
                    background: "var(--card-bg, #fff)",
                  }}
                >
                  <small className="muted-text">متوسط التكلفة</small>
                  <div style={{ fontWeight: 600 }}>
                    {fm(detail.averageCost)}
                  </div>
                </div>
              )}
            </div>

            {adjust && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  marginTop: "0.5rem",
                }}
              >
                <Button
                  variant="outline"
                  onClick={() => {
                    setDetail(null);
                    setOpen(true);
                  }}
                >
                  <Plus size={16} />
                  تسوية رصيد هذا المخزن
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
              }
