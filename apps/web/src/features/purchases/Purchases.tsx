import "./purchases.css";
import { useEffect, useRef, useState } from "react";
import { Plus, Eye, Printer, Trash2, FileText } from "lucide-react";
import { post } from "../../api";
import {
  formatDigits,
  ar,
  formatDate as baseDate,
  formatMoney as baseMoney,
} from "../../i18n";
import { Button } from "../../components/ui/button";
import { useAction } from "../../app/notifications";
import { useData, useAllowed } from "../../hooks/useData";
import {
  Loading,
  ErrorState,
  Modal,
  Field,
  Header,
  Badge,
  Table,
  Pager,
} from "../../components/application/Primitives";
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
  r.items.reduce((s: number, i: Row) => s + Number(i.unitCost) * i.quantity, 0);

const percent = (v: number) =>
  `${new Intl.NumberFormat("ar-EG-u-nu-latn", { maximumFractionDigits: 1 }).format(v)}٪`;

export function Purchases() {
  const [offset, setOffset] = useState(0),
    query = useData(`/purchases?offset=${offset}`),
    suppliers = useData("/suppliers?limit=100"),
    locations = useData("/locations"),
    products = useData("/products?limit=100"),
    outsideHandler = useRef<() => void>(() => {}),
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
      <Modal
        title="أمر شراء جديد"
        open={open}
        onClose={() => setOpen(false)}
        onOutsideClick={() => outsideHandler.current()}
      >
        <PurchaseForm
          suppliers={suppliers.data?.data ?? []}
          locations={locations.data?.data ?? []}
          products={products.data?.data ?? []}
          busy={action.busy}
          registerOutside={(fn) => (outsideHandler.current = fn)}
          close={() => setOpen(false)}
          submit={(body) =>
            void action.run(
              () => post("/purchases", body),
              () => {
                clearPurchaseDraft();
                setOpen(false);
              },
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
            <div className="purchase-invoice-actions no-print">
              <Button
                className="no-print"
                variant="outline"
                onClick={() => window.print()}
              >
                <Printer size={17} />
                طباعة الفاتورة
              </Button>
              <Button asChild variant="outline">
                <a
                  href={`/api/purchases/${preview.id}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FileText size={17} />
                  عرض PDF
                </a>
              </Button>
            </div>
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

function InvoiceItemName({ item }: { item: Row }) {
  const variant = item.variant;
  return (
    <>
      <span className="invoice-product-name">
        {variant?.product?.nameAr ?? variant?.sku ?? item.variantId}
      </span>
      {variant && (
        <span className="invoice-variant">
          {Object.entries(variant.options ?? {}).map(([key, value]) => (
            <span key={key}>
              {key === "size" ? "المقاس" : key === "color" ? "اللون" : key}:{" "}
              <bdi>{formatDigits(String(value))}</bdi>
            </span>
          ))}
        </span>
      )}
    </>
  );
}

function PurchaseInvoice({ order }: { order: Row }) {
  const totalQty = order.items.reduce((s: number, i: Row) => s + i.quantity, 0),
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
            <th>المقاس</th>
            <th>اللون</th>
            <th>الكمية</th>
            <th>تم استلامه</th>
            <th>سعر الشراء</th>
            <th>الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((i: Row) => (
            <tr key={i.id}>
              <td>
                {i.variant?.product?.nameAr ?? i.variant?.sku ?? i.variantId}
              </td>
              <td>
                <bdi>
                  {formatDigits(String(i.variant?.options?.size ?? "—"))}
                </bdi>
              </td>
              <td>{i.variant?.options?.color ?? "—"}</td>
              <td>{i.quantity}</td>
              <td>{i.received}</td>
              <td>
                <span className="invoice-money" dir="ltr">
                  {fm(i.unitCost)}
                </span>
              </td>
              <td>
                <span className="invoice-money" dir="ltr">
                  {fm(Number(i.unitCost) * i.quantity)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>الإجمالي</td>
            <td></td>
            <td></td>
            <td>{totalQty}</td>
            <td>{totalReceived}</td>
            <td></td>
            <td>
              <span className="invoice-money" dir="ltr">
                {fm(orderTotal(order))}
              </span>
            </td>
          </tr>
        </tfoot>
      </table>
      <div className="invoice-mobile-items">
        {order.items.map((i: Row) => (
          <article className="invoice-item-card" key={i.id}>
            <strong className="invoice-item-name">
              <InvoiceItemName item={i} />
            </strong>
            <dl>
              <div>
                <dt>الكمية</dt>
                <dd>{i.quantity}</dd>
              </div>
              <div>
                <dt>تم استلامه</dt>
                <dd>{i.received}</dd>
              </div>
              <div>
                <dt>سعر الشراء</dt>
                <dd>
                  <span className="invoice-money" dir="ltr">
                    {fm(i.unitCost)}
                  </span>
                </dd>
              </div>
              <div>
                <dt>الإجمالي</dt>
                <dd>
                  <span className="invoice-money" dir="ltr">
                    {fm(Number(i.unitCost) * i.quantity)}
                  </span>
                </dd>
              </div>
            </dl>
          </article>
        ))}
        <div className="invoice-mobile-total">
          <strong>الإجمالي</strong>
          <span>
            الكمية: {totalQty} • تم استلامه: {totalReceived}
          </span>
          <strong className="invoice-money" dir="ltr">
            {fm(orderTotal(order))}
          </strong>
        </div>
      </div>
      {order.receipts?.length > 0 && (
        <div className="invoice-receipts">
          <h3>سجل الاستلام</h3>
          {order.receipts.map((rc: Row) => (
            <div className="receipt-line" key={rc.id}>
              <span>{formatDate(rc.createdAt)}</span>
              <strong className="invoice-money" dir="ltr">
                {fm(rc.total)}
              </strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const DRAFT_KEY = "azs.purchaseDraft.v1";

type LineValues = { v?: string; q: string; c: string; sp: string; ms?: string };
type PurchaseDraft = {
  supplierId: string;
  locationId: string;
  lines: LineValues[];
};

function readPurchaseDraft(): PurchaseDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as PurchaseDraft;
    return draft && Array.isArray(draft.lines) && draft.lines.length
      ? draft
      : null;
  } catch {
    return null;
  }
}

function clearPurchaseDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

export function PurchaseForm({
  suppliers,
  locations,
  products,
  busy,
  submit,
  close,
  registerOutside,
}: {
  suppliers: Row[];
  locations: Row[];
  products: Row[];
  busy: boolean;
  submit: (v: Row) => void;
  close: () => void;
  registerOutside: (fn: () => void) => void;
}) {
  const [initialDraft] = useState(readPurchaseDraft);
  const [lineIds, setLineIds] = useState<number[]>(() =>
    initialDraft ? initialDraft.lines.map((_, i) => i) : [0],
  );
  const nextLineId = useRef(lineIds.length);
  const [lineValues, setLineValues] = useState<Record<number, LineValues>>(
    () => {
      const out: Record<number, LineValues> = {};
      initialDraft?.lines.forEach((l, i) => {
        out[i] = l;
      });
      return out;
    },
  );
  const [asking, setAsking] = useState(false);
  const [dupWarning, setDupWarning] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const draftSnapshot = useRef<PurchaseDraft | null>(null);
  const lineIdsRef = useRef(lineIds);
  lineIdsRef.current = lineIds;

  useEffect(() => {
    registerOutside(() => {
      // Snapshot before the form unmounts for the confirmation panel.
      draftSnapshot.current = collectDraft();
      setAsking(true);
    });
  }, [registerOutside]);

  const allVariants = products.flatMap((p: Row) =>
    p.variants.map((v: Row) => ({ ...v, productNameAr: p.nameAr })),
  );

  const variantLabel = (variantId: string) => {
    const v = allVariants.find((x) => x.id === variantId);
    if (!v) return "";
    const options = formatDigits(Object.values(v.options ?? {}).join(" / "));
    return `${v.productNameAr ?? v.sku ?? "صنف"}${options ? ` • ${options}` : ""}`;
  };

  const setLineValue = (
    i: number,
    key: "v" | "q" | "c" | "sp",
    value: string,
  ) =>
    setLineValues((prev) => ({
      ...prev,
      [i]: { q: "1", c: "", sp: "", ...prev[i], [key]: value },
    }));

  const handleVariantChange = (lineIndex: number, variantId: string) => {
    const variant = allVariants.find((v) => v.id === variantId);
    setLineValues((prev) => ({
      ...prev,
      [lineIndex]: {
        q: "1",
        sp: "",
        ...prev[lineIndex],
        v: variantId,
        c: variant?.cost !== undefined ? String(variant.cost) : "",
      },
    }));
  };

  const addLine = () => setLineIds((prev) => [...prev, nextLineId.current++]);

  const removeLine = (id: number) => {
    setLineIds((prev) =>
      prev.length > 1 ? prev.filter((x) => x !== id) : prev,
    );
    setLineValues((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
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

  const totals = lineIds
    .map((id) => lineNumbers(id))
    .reduce(
      (t, n) => ({
        cost: t.cost + n.totalCost,
        profit: t.profit + (n.ready ? n.totalProfit : 0),
      }),
      { cost: 0, profit: 0 },
    );

  // Same variant entered on more than one row with a different cost price.
  const conflictingVariant = (() => {
    const costs = new Map<string, Set<string>>();
    for (const id of lineIds) {
      const v = lineValues[id];
      if (!v?.v || v.c === "") continue;
      const set = costs.get(v.v) ?? new Set<string>();
      set.add(String(Number(v.c)));
      costs.set(v.v, set);
    }
    for (const [variantId, set] of costs) if (set.size > 1) return variantId;
    return null;
  })();

  const collectDraft = (): PurchaseDraft => {
    const f = new FormData(formRef.current ?? undefined);
    return {
      supplierId: String(f.get("supplierId") ?? ""),
      locationId: String(f.get("locationId") ?? ""),
      lines: lineIdsRef.current.map((id) => ({
        v: String(f.get(`v${id}`) ?? ""),
        q: String(f.get(`q${id}`) ?? "1"),
        c: String(f.get(`c${id}`) ?? ""),
        sp: String(f.get(`sp${id}`) ?? ""),
        ms: String(f.get(`ms${id}`) ?? ""),
      })),
    };
  };

  if (asking) {
    return (
      <div className="entry-form">
        <p>أمر الشراء يحتوي على بيانات غير محفوظة.</p>
        <p>هل تريد حفظ البيانات كمسودة قبل الإغلاق؟</p>
        <Button
          onClick={() => {
            try {
              const draft = draftSnapshot.current ?? collectDraft();
              localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
            } catch {
              /* ignore */
            }
            close();
          }}
        >
          حفظ البيانات وإغلاق
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            clearPurchaseDraft();
            close();
          }}
        >
          إغلاق بدون حفظ
        </Button>
        <Button variant="outline" onClick={() => setAsking(false)}>
          متابعة التحرير
        </Button>
      </div>
    );
  }

  return (
    <form
      {...arabicFormValidation()}
      className="entry-form"
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const rawItems = lineIds.map((id) => ({
          variantId: String(f.get(`v${id}`) ?? ""),
          quantity: Number(f.get(`q${id}`)),
          unitCost: String(f.get(`c${id}`) ?? ""),
          salePrice: String(f.get(`sp${id}`) ?? ""),
          ...(f.get(`ms${id}`) ? { minStock: Number(f.get(`ms${id}`)) } : {}),
        }));
        // Same item with a different cost price must not merge: warn and stop.
        const costs = new Map<string, Set<string>>();
        for (const item of rawItems) {
          const set = costs.get(item.variantId) ?? new Set<string>();
          set.add(String(Number(item.unitCost)));
          costs.set(item.variantId, set);
        }
        const conflict = [...costs].find(([, set]) => set.size > 1);
        if (conflict) {
          setDupWarning(
            `الصنف "${variantLabel(conflict[0])}" مدخل أكثر من مرة بسعر تكلفة مختلف. صحّح السعر أو احذف الصف الزائد.`,
          );
          return;
        }
        setDupWarning("");
        // Same item with the same cost price merges into one line (quantities sum).
        const merged: typeof rawItems = [];
        const index = new Map<string, number>();
        for (const item of rawItems) {
          const key = `${item.variantId}|${Number(item.unitCost)}`;
          const at = index.get(key);
          if (at === undefined) {
            index.set(key, merged.length);
            merged.push({ ...item });
          } else {
            merged[at]!.quantity += item.quantity;
          }
        }
        submit({
          supplierId: f.get("supplierId"),
          locationId: f.get("locationId"),
          items: merged,
        });
      }}
    >
      <div className="form-grid">
        <Field label={ar.supplier}>
          <select
            required
            name="supplierId"
            defaultValue={initialDraft?.supplierId ?? ""}
          >
            <option value="">اختر...</option>
            {suppliers.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={ar.location}>
          <select
            required
            name="locationId"
            defaultValue={initialDraft?.locationId ?? ""}
          >
            <option value="">اختر...</option>
            {locations.map((l) => (
              <option value={l.id} key={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {lineIds.map((id, i) => {
        const n = lineNumbers(id);
        return (
          <div className="purchase-line-card" key={id}>
            {lineIds.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                className="purchase-line-remove"
                title="حذف الصنف"
                aria-label={`حذف الصنف ${i + 1}`}
                onClick={() => removeLine(id)}
              >
                <Trash2 size={16} />
              </Button>
            )}
            <Field label={`الصنف ${i + 1}`}>
              <select
                name={`v${id}`}
                required
                defaultValue={lineValues[id]?.v ?? ""}
                onChange={(e) => handleVariantChange(id, e.target.value)}
              >
                <option value="">اختر...</option>
                {products.flatMap((p) =>
                  p.variants.map((v: Row) => (
                    <option key={v.id} value={v.id}>
                      {p.nameAr} •{" "}
                      {formatDigits(
                        Object.values(v.options ?? {}).join(" / "),
                      ) || "بدون مقاس أو لون"}
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
                  name={`q${id}`}
                  min="1"
                  step="1"
                  value={lineValues[id]?.q ?? "1"}
                  onChange={(e) => setLineValue(id, "q", e.target.value)}
                />
              </Field>
              <Field label="التكلفة — سعر الشراء">
                <input
                  required
                  type="number"
                  name={`c${id}`}
                  min="0"
                  step="0.01"
                  value={lineValues[id]?.c ?? ""}
                  onChange={(e) => setLineValue(id, "c", e.target.value)}
                />
              </Field>
              <Field label="سعر البيع">
                <input
                  required
                  type="number"
                  name={`sp${id}`}
                  min="0"
                  step="0.01"
                  value={lineValues[id]?.sp ?? ""}
                  onChange={(e) => setLineValue(id, "sp", e.target.value)}
                />
              </Field>
              <Field label="الحد الأدنى">
                <input
                  type="number"
                  name={`ms${id}`}
                  min="0"
                  placeholder="ديناميكي"
                  defaultValue={lineValues[id]?.ms ?? ""}
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
                    <strong>{n.pct === null ? "—" : percent(n.pct)}</strong>
                  </span>
                </>
              ) : (
                "أدخل التكلفة وسعر البيع ليظهر ربح القطعة ونسبة الربح"
              )}
            </div>
          </div>
        );
      })}
      {conflictingVariant && (
        <p className="form-error" role="alert">
          الصنف "{variantLabel(conflictingVariant)}" مدخل أكثر من مرة بسعر تكلفة
          مختلف. صحّح السعر أو احذف الصف الزائد.
        </p>
      )}
      {dupWarning && (
        <p className="form-error" role="alert">
          {dupWarning}
        </p>
      )}
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
            {totals.cost > 0
              ? percent((totals.profit / totals.cost) * 100)
              : "—"}
          </strong>
        </div>
      </div>
      <p className="note">
        التكلفة هي سعر الشراء من المورد. سعر البيع مطلوب ويُحدَّث به سعر المنتج
        فوراً.
      </p>
      <Button type="button" variant="outline" onClick={addLine}>
        <Plus size={16} />
        صنف آخر
      </Button>
      <Button disabled={busy}>{ar.save}</Button>
    </form>
  );
}
