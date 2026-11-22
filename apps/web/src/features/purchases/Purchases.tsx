import { useState } from "react";
import { Plus } from "lucide-react";
import { post } from "../../api";
import { ar, formatDate, formatMoney as fm } from "../../i18n";
import { Button } from "../../components/ui/button";
import { useAction } from "../../app/notifications";
import { useData, useAllowed } from "../../hooks/useData";
import { Loading, ErrorState, Modal, Field, Header, Badge, Table, Pager } from "../../components/application/Primitives";
import { type Row } from "../../app/types";
import { arabicFormValidation } from "../../components/application/arabicFormValidation";

export function Purchases() {
  const [offset, setOffset] = useState(0),
    query = useData(`/purchases?offset=${offset}`),
    suppliers = useData("/suppliers?limit=100"),
    locations = useData("/locations"),
    products = useData("/products?limit=100"),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState<Row | null>(null),
    action = useAction(),
    create = useAllowed("purchases.create"),
    receive = useAllowed("purchases.receive");
  return (
    <>
      <Header
        title={ar.purchases}
        subtitle="من أمر الشراء إلى دخول القطع إلى المخزن"
      >
        {create && (
          <Button onClick={() => setOpen(true)}>
            <Plus size={18} />
            أمر شراء جديد
          </Button>
        )}
      </Header>
      <section className="panel">
        {query.isLoading ? (
          <Loading />
        ) : query.error ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            <Table
              rows={query.data?.data ?? []}
              columns={[
                { label: ar.supplier, render: (r) => r.supplier.name },
                { label: ar.date, render: (r) => formatDate(r.createdAt) },
                {
                  label: ar.quantity,
                  render: (r) =>
                    r.items.reduce((s: number, i: Row) => s + i.quantity, 0),
                },
                {
                  label: "تم استلامه",
                  render: (r) =>
                    r.items.reduce((s: number, i: Row) => s + i.received, 0),
                },
                {
                  label: ar.total,
                  render: (r) =>
                    fm(
                      r.items.reduce(
                        (s: number, i: Row) =>
                          s + Number(i.unitCost) * i.quantity,
                        0,
                      ),
                    ),
                },
                { label: ar.status, render: (r) => <Badge value={r.status} /> },
                {
                  label: ar.actions,
                  render: (r) =>
                    receive && (
                      <div className="inline-actions">
                        {r.status === "DRAFT" ? (
                          <Button
                            variant="outline"
                            disabled={action.busy}
                            onClick={() =>
                              void action.run(() =>
                                post(`/purchases/${r.id}/approve`, {}),
                              )
                            }
                          >
                            اعتماد
                          </Button>
                        ) : (
                          ["APPROVED", "PARTIAL"].includes(r.status) && (
                            <Button
                              variant="outline"
                              onClick={() => setSelected(r)}
                            >
                              استلام
                            </Button>
                          )
                        )}
                      </div>
                    ),
                },
              ]}
            />
            <Pager
              offset={offset}
              setOffset={setOffset}
              length={query.data?.data.length ?? 0}
            />
          </>
        )}
      </section>
      <Modal title="أمر شراء جديد" open={open} onClose={() => setOpen(false)}>
        <PurchaseForm
          suppliers={suppliers.data?.data ?? []}
          locations={locations.data?.data ?? []}
          products={products.data?.data ?? []}
          busy={action.busy}
          submit={(body) =>
            void action.run(
              () => post("/purchases", body),
              () => setOpen(false),
            )
          }
        />
      </Modal>
      <Modal
        title="استلام المشتريات"
        open={!!selected}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <form
          {...arabicFormValidation()}
            className="entry-form"
            onSubmit={(e) => {
              e.preventDefault();
              const values = new FormData(e.currentTarget);
              void action.run(
                () =>
                  post(
                    `/purchases/${selected.id}/receive`,
                    {
                      items: selected.items
                        .map((i: Row) => ({
                          purchaseItemId: i.id,
                          quantity: Number(values.get(i.id)),
                        }))
                        .filter((i: Row) => i.quantity > 0),
                    },
                    crypto.randomUUID(),
                  ),
                () => setSelected(null),
              );
            }}
          >
            {selected.items
              .filter((i: Row) => i.received < i.quantity)
              .map((i: Row) => (
                <Field
                  key={i.id}
                  label={`${products.data?.data.flatMap((p: Row) => p.variants).find((v: Row) => v.id === i.variantId)?.sku ?? i.variantId} • المتبقي ${i.quantity - i.received}`}
                >
                  <input
                    type="number"
                    name={i.id}
                    min="0"
                    step="1"
                    max={i.quantity - i.received}
                    defaultValue={i.quantity - i.received}
                  />
                </Field>
              ))}
            <Button disabled={action.busy}>تأكيد الاستلام</Button>
          </form>
        )}
      </Modal>
    </>
  );
}

export function PurchaseForm({
  suppliers,
  locations,
  products,
  busy,
  submit,
}: {
  suppliers: Row[];
  locations: Row[];
  products: Row[];
  busy: boolean;
  submit: (v: Row) => void;
}) {
  const [lines, setLines] = useState(1);
  const [linePrices, setLinePrices] = useState<Record<number, string>>({});

  const allVariants = products.flatMap((p: Row) =>
    p.variants.map((v: Row) => ({ ...v, productNameAr: p.nameAr })),
  );

  const handleVariantChange = (lineIndex: number, variantId: string) => {
    const variant = allVariants.find((v) => v.id === variantId);
    if (variant?.price) {
      setLinePrices((prev) => ({ ...prev, [lineIndex]: String(variant.price) }));
    } else {
      setLinePrices((prev) => ({ ...prev, [lineIndex]: "" }));
    }
  };

  return (
    <form
          {...arabicFormValidation()}
      className="entry-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        submit({
          supplierId: f.get("supplierId"),
          locationId: f.get("locationId"),
          items: Array.from({ length: lines }, (_, i) => ({
            variantId: f.get(`v${i}`),
            quantity: Number(f.get(`q${i}`)),
            unitCost: f.get(`c${i}`),
            salePrice: f.get(`sp${i}`),
            ...(f.get(`ms${i}`) ? { minStock: Number(f.get(`ms${i}`)) } : {}),
          })),
        });
      }}
    >
      <div className="form-grid">
        <Field label={ar.supplier}>
          <select required name="supplierId">
            <option value="">اختر...</option>
            {suppliers.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={ar.location}>
          <select required name="locationId">
            <option value="">اختر...</option>
            {locations.map((l) => (
              <option value={l.id} key={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {Array.from({ length: lines }, (_, i) => (
        <div className="purchase-line" key={i}>
          <Field label="الصنف">
            <select
              name={`v${i}`}
              required
              onChange={(e) => handleVariantChange(i, e.target.value)}
            >
              <option value="">اختر...</option>
              {products.flatMap((p) =>
                p.variants.map((v: Row) => (
                  <option key={v.id} value={v.id}>
                    {p.nameAr} • {Object.values(v.options ?? {}).join(" / ") || "بدون مقاس أو لون"}
                  </option>
                )),
              )}
            </select>
          </Field>
          <Field label={ar.quantity}>
            <input
              required
              type="number"
              name={`q${i}`}
              min="1"
              step="1"
              defaultValue="1"
            />
          </Field>
          <Field label="التكلفة — سعر الشراء">
            <input
              required
              type="number"
              name={`c${i}`}
              min="0"
              step="0.01"
              value={linePrices[i] ?? ""}
              onChange={(e) =>
                setLinePrices((prev) => ({ ...prev, [i]: e.target.value }))
              }
            />
          </Field>
          <Field label="سعر البيع">
            <input
              required
              type="number"
              name={`sp${i}`}
              min="0"
              step="0.01"
            />
          </Field>
          <Field label="الحد الأدنى">
            <input
              type="number"
              name={`ms${i}`}
              min="0"
              placeholder="ديناميكي"
            />
          </Field>
        </div>
      ))}
      <p className="note">
        التكلفة هي سعر الشراء من المورد. سعر البيع مطلوب ويُحدَّث به سعر المنتج فوراً.
      </p>
      <Button
        type="button"
        variant="outline"
        onClick={() => setLines((n) => n + 1)}
      >
        <Plus size={16} />
        صنف آخر
      </Button>
      <Button disabled={busy}>{ar.save}</Button>
    </form>
  );
            }
