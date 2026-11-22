import { useState } from "react";
import { Plus, Eye, Printer } from "lucide-react";
import { post } from "../../api";
import { formatDigits, ar, formatDate as baseDate, formatMoney as baseMoney } from "../../i18n";
import { Button } from "../../components/ui/button";
import { useAction } from "../../app/notifications";
import { useData, useAllowed } from "../../hooks/useData";
import { Loading, ErrorState, Modal, Field, Header, Badge, Table, Pager } from "../../components/application/Primitives";
import { type Row } from "../../app/types";
import { arabicFormValidation } from "../../components/application/arabicFormValidation";

const fm = (v: unknown) => baseMoney(v, "latn");
const formatDate = (v: unknown) => baseDate(v, "latn");

const itemName = (i: Row) => {
  const v = i.variant;
  if (!v) return i.variantId;
  const options = formatDigits(Object.values(v.options ?? {}).join(" / "));
  return `${v.product?.nameAr ?? v.sku ?? "صنف"}${options ? ` • ${options}` : ""}`;
};

const orderTotal = (r: Row) =>
  r.items.reduce(
    (s: number, i: Row) => s + Number(i.unitCost) * i.quantity,
    0,
  );

const percent = (v: number) =>
  `${new Intl.NumberFormat("ar-EG-u-nu-latn", { maximumFractionDigits: 1 }).format(v)}٪`;

export function Purchases() {
  const [offset, setOffset] = useState(0),
    query = useData(`/purchases?offset=${offset}`),
    suppliers = useData("/suppliers?limit=100"),
    locations = useData("/locations"),
    products = useData("/products?limit=100"),
    [open, setOpen] = useState(false),
    [selected, setSelected] = useState<Row | null>(null),
    [approving, setApproving] = useState<Row | null>(null),
    [preview, setPreview] = useState<Row | null>(null),
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
              onRowClick={(r) => setPreview(r)}
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
                  render: (r) => fm(orderTotal(r)),
                },
                { label: ar.status, render: (r) => <Badge value={r.status} /> },
                {
                  label: ar.actions,
                  render: (r) => (
                    <div className="inline-actions">
                      <Button
                        variant="outline"
                        title="معاينة الفاتورة"
                        aria-label="معاينة الفاتورة"
                        onClick={() => setPreview(r)}
                      >
                        <Eye size={17} />
                      </Button>
                      {receive && r.status === "DRAFT" ? (
                        <Button
                          variant="outline"
                          disabled={action.busy}
                          onClick={() => setApproving(r)}
                        >
                          اعتماد
                        </Button>
                      ) : (
                        receive &&
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
        title="معاينة فاتورة المشتريات"
        open={!!preview}
        onClose={() => setPreview(null)}
      >
        {preview && (
          <>
            <PurchaseInvoice order={preview} />
            <Button
              className="no-print"
              variant="outline"
              onClick={() => window.print()}
            >
              <Printer size={17} />
              طباعة الفاتورة
            </Button>
          </>
        )}
      </Modal>
      <Modal
        title="تأكيد اعتماد فاتورة المشتريات"
        open={!!approving}
        onClose={() => setApproving(null)}
      >
        {approving && (
          <div className="entry-form">
            <p>هل أنت متأكد من اعتماد فاتورة المشتريات التالية؟</p>
            <ul className="confirm-list">
              {approving.items.map((i: Row) => (
                <li key={i.id}>
                  <span>{itemName(i)}</span>
                  <strong>× {i.quantity}</strong>
                </li>
              ))}
            </ul>
            <p className="note">
              المورد: {approving.supplier.name} • الإجمالي:{" "}
              {fm(orderTotal(approving))}
            </p>
            <Button
              disabled={action.busy}
              onClick={() =>
                void action.run(
                  () => post(`/purchases/${approving.id}/approve`, {}),
                  () => setApproving(null),
                )
              }
            >
              تأكيد الاعتماد
            </Button>
            <Button variant="outline" onClick={() => setApproving(null)}>
              {ar.cancel}
            </Button>
          </div>
        )}
      </Modal>
      <Modal
        title="استلام المشتريات"
        open={!!selected}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <ReceiveForm
            order={selected}
            busy={action.busy}
            submit={(items) =>
              void action.run(
                () =>
                  post(
                    `/purchases/${selected.id}/receive`,
                    { items },
                    crypto.randomUUID(),
                  ),
                () => setSelected(null),
              )
            }
          />
        )}
      </Modal>
    </>
  );
}

function ReceiveForm({
  order,
  busy,
  submit,
}: {
  order: Row;
  busy: boolean;
  submit: (items: { purchaseItemId: string; quantity: number }[]) => void;
}) {
  const [pending, setPending] = useState<
    { purchaseItemId: string; name: string; quantity: number }[] | null
  >(null);
  const receivable = order.items.filter((i: Row) => i.received < i.quantity);
  if (pending) {
    return (
      <div className="entry-form">
        <p>هل أنت متأكد من استلام الأصناف التالية؟</p>
        <ul className="confirm-list">
          {pending.map((i) => (
            <li key={i.purchaseItemId}>
              <span>{i.name}</span>
              <strong>× {i.quantity}</strong>
            </li>
          ))}
        </ul>
        <Button
          disabled={busy}
          onClick={() =>
            submit(
              pending.map((i) => ({
                purchaseItemId: i.purchaseItemId,
                quantity: i.quantity,
              })),
            )
          }
        >
          تأكيد الاستلام
        </Button>
        <Button variant="outline" onClick={() => setPending(null)}>
          رجوع
        </Button>
      </div>
    );
  }
  return (
    <form
      {...arabicFormValidation()}
      className="entry-form"
      onSubmit={(e) => {
        e.preventDefault();
        const values = new FormData(e.currentTarget);
        const items = order.items
          .map((i: Row) => ({
            purchaseItemId: i.id,
            name: itemName(i),
            quantity: Number(values.get(i.id)),
          }))
          .filter((i: Row) => i.quantity > 0);
        if (!items.length) return;
        setPending(items);
      }}
    >
      {receivable.map((i: Row) => (
        <Field
          key={i.id}
          label={`${itemName(i)} • المتبقي ${i.quantity - i.received}`}
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
      <Button disabled={busy}>مراجعة الاستلام</Button>
    </form>
  );
}

function PurchaseInvoice({ order }: { order: Row }) {
  const totalQty = order.items.reduce(
      (s: number, i: Row) => s + i.quantity,
      0,
    ),
    totalReceived = order.items.reduce(
      (s: number, i: Row) => s + i.received,
      0,
    );
  return (
    <div className="print-zone purchase-invoice">
      <div className="invoice-head">
        <div>
          <strong className="invoice-brand">A&Z Girls Fashion</strong>
          <p className="invoice-sub">فاتورة مشتريات</p>
        </div>
        <Badge value={order.status} />
      </div>
      <div className="invoice-meta">
        <div>
          <span>المورد</span>
          <strong>{order.supplier.name}</strong>
        </div>
        <div>
          <span>المخزن</span>
          <strong>{order.location?.name ?? "—"}</strong>
        </div>
        <div>
          <span>التاريخ</span>
          <strong>{formatDate(order.createdAt)}</strong>
        </div>
        <div>
          <span>عدد الأصناف</span>
          <strong>{order.items.length}</strong>
        </div>
      </div>
      <table className="invoice-table">
        <thead>
          <tr>
            <th>الصنف</th>
            <th>الكمية</th>
            <th>تم استلامه</th>
            <th>سعر الشراء</th>
            <th>الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((i: Row) => (
            <tr key={i.id}>
              <td>{itemName(i)}</td>
              <td>{i.quantity}</td>
              <td>{i.received}</td>
              <td>{fm(i.unitCost)}</td>
              <td>{fm(Number(i.unitCost) * i.quantity)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>الإجمالي</td>
            <td>{totalQty}</td>
            <td>{totalReceived}</td>
            <td></td>
            <td>{fm(orderTotal(order))}</td>
          </tr>
        </tfoot>
      </table>
      {order.receipts?.length > 0 && (
        <div className="invoice-receipts">
          <h3>سجل الاستلام</h3>
          {order.receipts.map((rc: Row) => (
            <div className="receipt-line" key={rc.id}>
              <span>{formatDate(rc.createdAt)}</span>
              <strong>{fm(rc.total)}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
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
  const [lineValues, setLineValues] = useState<
    Record<number, { q: string; c: string; sp: string }>
  >({});

  const allVariants = products.flatMap((p: Row) =>
    p.variants.map((v: Row) => ({ ...v, productNameAr: p.nameAr })),
  );

  const setLineValue = (i: number, key: "q" | "c" | "sp", value: string) =>
    setLineValues((prev) => ({
      ...prev,
      [i]: { q: "1", c: "", sp: "", ...prev[i], [key]: value },
    }));

  const handleVariantChange = (lineIndex: number, variantId: string) => {
    const variant = allVariants.find((v) => v.id === variantId);
    setLineValue(lineIndex, "c", variant?.cost !== undefined ? String(variant.cost) : "");
  };

  const lineNumbers = (i: number) => {
    const v = lineValues[i] ?? { q: "1", c: "", sp: "" };
    const q = Number(v.q) || 0,
      cost = Number(v.c) || 0,
      sale = Number(v.sp) || 0;
    const profit = sale - cost;
    return {
      q,
      cost,
      sale,
      profit,
      pct: cost > 0 ? (profit / cost) * 100 : null,
      totalProfit: profit * q,
      totalCost: cost * q,
      ready: v.c !== "" && v.sp !== "",
    };
  };

  const totals = Array.from({ length: lines }, (_, i) => lineNumbers(i)).reduce(
    (t, n) => ({
      cost: t.cost + n.totalCost,
      profit: t.profit + (n.ready ? n.totalProfit : 0),
    }),
    { cost: 0, profit: 0 },
  );

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
      {Array.from({ length: lines }, (_, i) => {
        const n = lineNumbers(i);
        return (
          <div className="purchase-line-card" key={i}>
            <Field label={`الصنف ${i + 1}`}>
              <select
                name={`v${i}`}
                required
                onChange={(e) => handleVariantChange(i, e.target.value)}
              >
                <option value="">اختر...</option>
                {products.flatMap((p) =>
                  p.variants.map((v: Row) => (
                    <option key={v.id} value={v.id}>
                      {p.nameAr} •{" "}
                      {formatDigits(Object.values(v.options ?? {}).join(" / ")) ||
                        "بدون مقاس أو لون"}
                    </option>
                  )),
                )}
              </select>
            </Field>
            <div className="line-grid">
              <Field label={ar.quantity}>
                <input
                  required
                  type="number"
                  name={`q${i}`}
                  min="1"
                  step="1"
                  value={lineValues[i]?.q ?? "1"}
                  onChange={(e) => setLineValue(i, "q", e.target.value)}
                />
              </Field>
              <Field label="التكلفة — سعر الشراء">
                <input
                  required
                  type="number"
                  name={`c${i}`}
                  min="0"
                  step="0.01"
                  value={lineValues[i]?.c ?? ""}
                  onChange={(e) => setLineValue(i, "c", e.target.value)}
                />
              </Field>
              <Field label="سعر البيع">
                <input
                  required
                  type="number"
                  name={`sp${i}`}
                  min="0"
                  step="0.01"
                  value={lineValues[i]?.sp ?? ""}
                  onChange={(e) => setLineValue(i, "sp", e.target.value)}
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
            <div
              className={`profit-readout ${
                n.ready ? (n.profit < 0 ? "negative" : "positive") : ""
              }`}
            >
              {n.ready ? (
                <>
                  <span>
                    ربح القطعة <strong>{fm(n.profit)}</strong>
                  </span>
                  <span>
                    نسبة الربح على التكلفة{" "}
                    <strong>
                      {n.pct === null ? "—" : percent(n.pct)}
                    </strong>
                  </span>
                </>
              ) : (
                "أدخل التكلفة وسعر البيع ليظهر ربح القطعة ونسبة الربح"
              )}
            </div>
          </div>
        );
      })}
      <div className="purchase-totals">
        <div>
          <span>إجمالي التكلفة</span>
          <strong>{fm(totals.cost)}</strong>
        </div>
        <div>
          <span>إجمالي الربح المتوقع</span>
          <strong>{fm(totals.profit)}</strong>
        </div>
        <div>
          <span>نسبة الربح الإجمالية</span>
          <strong>
            {totals.cost > 0 ? percent((totals.profit / totals.cost) * 100) : "—"}
          </strong>
        </div>
      </div>
      <p className="note">
        التكلفة هي سعر الشراء من المورد. سعر البيع مطلوب ويُحدَّث به سعر المنتج
        فوراً.
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
