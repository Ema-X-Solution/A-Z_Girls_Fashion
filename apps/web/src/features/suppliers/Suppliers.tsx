import { useId, useState, type ReactNode, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, Search, X, Wallet, RotateCcw, Printer, Pencil } from "lucide-react";
import { api, ApiError, patch, post, useSession } from "../../api";
import { Button } from "../../components/ui/button";
import { formatMoney as fm, formatDate } from "../../i18n";
import "./suppliers.css";
import { useDebouncedSearch } from "../../hooks/useDebouncedSearch";
type Row = Record<string, any>;
function Field({
  label,
  children,
}: {
  label: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  );
}
function Modal({
  title,
  open,
  close,
  children,
}: {
  title: string;
  open: boolean;
  close: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="modal" dir="rtl">
          <div className="modal-head">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" aria-label="إلغاء">
                <X size={18} />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            {title} — راجع البيانات قبل التأكيد.
          </Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
function useAction() {
  const client = useQueryClient(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  return {
    busy,
    error,
    message,
    run: async (fn: () => Promise<unknown>, done?: () => void) => {
      if (busy) return;
      setBusy(true);
      setError("");
      setMessage("");
      try {
        await fn();
        await client.invalidateQueries();
        done?.();
        setMessage("تم تسجيل العملية بنجاح");
      } catch (e) {
        const translations: Record<string, string> = {
          SUPPLIER_OVERPAYMENT: "المبلغ أكبر من الرصيد المستحق للمورد.",
          SHIFT_REQUIRED: "افتح وردية أولًا لتسجيل سداد من درج الكاشير.",
          SHIFT_CLOSED: "الوردية مغلقة. افتح وردية جديدة.",
          INSUFFICIENT_STOCK: "المخزون الحالي لا يكفي لإرجاع الكمية المحددة.",
          PURCHASE_RETURN_QUANTITY:
            "كمية المرتجع أكبر من المتبقي في فاتورة الاستلام.",
          VALIDATION: "راجع المبلغ والحقول المطلوبة.",
        };
        setError(
          e instanceof ApiError
            ? (translations[e.code] ?? e.message)
            : "تعذر تنفيذ العملية. حاول مرة أخرى.",
        );
      } finally {
        setBusy(false);
      }
    },
  };
}
function Status({
  busy,
  error,
  message,
}: {
  busy?: boolean;
  error?: string;
  message?: string;
}) {
  return (
    <>
      {busy && <p className="barcode-help">جارٍ تنفيذ العملية...</p>}
      {error && (
        <p className="barcode-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="supplier-success" role="status">
          {message}
        </p>
      )}
    </>
  );
}
function Pager({
  offset,
  setOffset,
  length,
  total,
}: {
  offset: number;
  setOffset: (v: number) => void;
  length: number;
  total: number;
}) {
  return (
    <div className="pager">
      <span>{total} سجل</span>
      <Button
        variant="outline"
        disabled={!offset}
        onClick={() => setOffset(Math.max(0, offset - 30))}
      >
        السابق
      </Button>
      <Button
        variant="outline"
        disabled={offset + length >= total}
        onClick={() => setOffset(offset + 30)}
      >
        التالي
      </Button>
    </div>
  );
}
function DataState({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: unknown;
  retry: () => void;
}) {
  return loading ? (
    <p className="barcode-help">جارٍ التحميل...</p>
  ) : error ? (
    <div className="empty">
      <p>تعذر تحميل البيانات.</p>
      <Button variant="outline" onClick={retry}>
        إعادة المحاولة
      </Button>
    </div>
  ) : null;
}

export function Suppliers() {
  const [q, setQ] = useState(""),
    [offset, setOffset] = useState(0),
    [open, setOpen] = useState(false),
    [editing, setEditing] = useState<Row | null>(null),
    action = useAction();
  const { debounced: debouncedQ, searchPending } = useDebouncedSearch(q);
  const query = useQuery({
    queryKey: ["suppliers", debouncedQ, offset],
    queryFn: ({ signal }) =>
      api(`/suppliers?q=${encodeURIComponent(debouncedQ)}&offset=${offset}`, {
        signal,
      }),
    enabled: !searchPending,
  });
  function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    void action.run(
      () =>
        post("/suppliers", { ...f, ...(!f.email ? { email: undefined } : {}) }),
      () => setOpen(false),
    );
  }
  function update(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const f = Object.fromEntries(new FormData(e.currentTarget));
    void action.run(
      () =>
        patch(`/suppliers/${editing.id}`, {
          ...f,
          ...(!f.email ? { email: undefined } : {}),
        }),
      () => setEditing(null),
    );
  }
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">A&Z • المشتريات والحسابات</div>
          <h1>الموردون وحساباتهم</h1>
          <p>فواتير الاستلام والسداد والمرتجعات في كشف حساب واحد.</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus size={18} />
          إضافة مورد
        </Button>
      </div>
      <Status error={action.error} message={action.message} />
      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Search size={18} />
            <input
              aria-label="بحث الموردين"
              placeholder="اسم المورد أو رقم الهاتف"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOffset(0);
              }}
            />
          </div>
          <span className="muted-text">{query.data?.total ?? 0} مورد</span>
        </div>
        <DataState
          loading={searchPending || query.isLoading}
          error={query.error}
          retry={() => void query.refetch()}
        />
        {!searchPending && query.data && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>المورد</th>
                    <th>الهاتف</th>
                    <th>العنوان</th>
                    <th>رصيد الحساب</th>
                    <th>الإجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.data.map((s: Row) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.name}</strong>
                      </td>
                      <td dir="ltr">{s.phone || "—"}</td>
                      <td>{s.address || "—"}</td>
                      <td>
                        <strong
                          className={
                            Number(s.currentBalance) < 0 ? "positive" : ""
                          }
                        >
                          {fm(Math.abs(Number(s.currentBalance)))}
                        </strong>
                        <small>
                          {Number(s.currentBalance) < 0
                            ? "رصيد لصالح المتجر"
                            : Number(s.currentBalance) > 0
                              ? "مستحق للمورد"
                              : "الحساب مسدد"}
                        </small>
                      </td>
                      <td>
                        <div className="inline-actions">
                          <Button variant="outline" onClick={() => setEditing(s)}>
                            <Pencil size={15} />
                            تعديل البيانات
                          </Button>
                          <Link
                            className="btn btn-outline"
                            to={`/suppliers/${s.id}`}
                          >
                            كشف الحساب والفواتير
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!query.data.data.length && (
                <div className="empty">لا يوجد موردون بعد.</div>
              )}
            </div>
            <Pager
              offset={offset}
              setOffset={setOffset}
              length={query.data.data.length}
              total={query.data.total}
            />
          </>
        )}
      </section>
      <Modal title="إضافة مورد" open={open} close={() => setOpen(false)}>
        <form onSubmit={create}>
          <div className="form-grid">
            <Field label="اسم المورد">
              {(id) => <input id={id} name="name" required maxLength={200} />}
            </Field>
            <Field label="الهاتف">
              {(id) => <input id={id} name="phone" maxLength={40} />}
            </Field>
            <Field label="البريد الإلكتروني (اختياري)">
              {(id) => <input id={id} name="email" type="email" />}
            </Field>
            <Field label="الرصيد الافتتاحي المستحق للمورد">
              {(id) => (
                <input
                  id={id}
                  name="openingBalance"
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue="0"
                  required
                />
              )}
            </Field>
          </div>
          <Field label="العنوان">
            {(id) => <input id={id} name="address" maxLength={1000} />}
          </Field>
          <Field label="ملاحظات">
            {(id) => <textarea id={id} name="notes" maxLength={2000} />}
          </Field>
          <Status busy={action.busy} error={action.error} />
          <Button disabled={action.busy}>حفظ المورد</Button>
        </form>
      </Modal>
      <Modal
        title="تعديل بيانات المورد"
        open={!!editing}
        close={() => setEditing(null)}
      >
        {editing && (
          <form onSubmit={update}>
            <p className="note">
              تعديل بيانات التواصل فقط؛ الرصيد الافتتاحي وحركات الحساب لا تتغير من هنا.
            </p>
            <div className="form-grid">
              <Field label="اسم المورد">
                {(id) => <input id={id} name="name" required maxLength={200} defaultValue={editing.name} />}
              </Field>
              <Field label="الهاتف">
                {(id) => <input id={id} name="phone" maxLength={40} defaultValue={editing.phone} />}
              </Field>
              <Field label="البريد الإلكتروني (اختياري)">
                {(id) => <input id={id} name="email" type="email" defaultValue={editing.email ?? ""} />}
              </Field>
            </div>
            <Field label="العنوان">
              {(id) => <input id={id} name="address" maxLength={1000} defaultValue={editing.address} />}
            </Field>
            <Field label="ملاحظات">
              {(id) => <textarea id={id} name="notes" maxLength={2000} defaultValue={editing.notes} />}
            </Field>
            <Status busy={action.busy} error={action.error} />
            <Button disabled={action.busy}>حفظ التعديلات</Button>
          </form>
        )}
      </Modal>
    </>
  );
}

export function SupplierDetails() {
  const { id } = useParams(),
    [tab, setTab] = useState("statement"),
    [offset, setOffset] = useState(0),
    [payment, setPayment] = useState(false),
    [method, setMethod] = useState("BANK"),
    [invoiceId, setInvoiceId] = useState<string | null>(null),
    [returning, setReturning] = useState(false),
    action = useAction();
  const canReturn = useSession((s) =>
    s.user?.permissions.includes("purchases.receive"),
  );
  const statement = useQuery({
    queryKey: ["supplier-statement", id, tab === "statement" ? offset : 0],
    queryFn: ({ signal }) =>
      api(
        `/suppliers/${id}/statement?offset=${tab === "statement" ? offset : 0}`,
        { signal },
      ),
  });
  const documents = useQuery({
    queryKey: ["supplier-documents", id, tab, offset],
    queryFn: ({ signal }) =>
      api(`/suppliers/${id}/${tab}?offset=${offset}`, { signal }),
    enabled: tab !== "statement",
  });
  const invoice = useQuery({
    queryKey: ["supplier-invoice", invoiceId],
    queryFn: ({ signal }) => api(`/supplier-invoices/${invoiceId}`, { signal }),
    enabled: !!invoiceId,
  });
  const shift = useQuery({
    queryKey: ["supplier-own-shift"],
    queryFn: () => api("/shifts/current"),
    enabled: payment && method === "CASH",
  });
  const data = statement.data?.data,
    rows =
      tab === "statement"
        ? (data?.entries ?? [])
        : (documents.data?.data ?? []),
    loading = tab === "statement" ? statement.isLoading : documents.isLoading,
    error = tab === "statement" ? statement.error : documents.error;
  const names: Record<string, string> = {
    OPENING: "رصيد افتتاحي",
    INVOICE: "فاتورة استلام",
    PAYMENT: "سداد للمورد",
    RETURN: "مرتجع للمورد",
  };
  function pay(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    void action.run(
      () =>
        post(
          `/suppliers/${id}/payments`,
          {
            ...f,
            method,
            ...(method === "CASH" ? { shiftId: shift.data?.data?.id } : {}),
          },
          crypto.randomUUID(),
        ),
      () => setPayment(false),
    );
  }
  function returnItems(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void action.run(
      () =>
        post(
          `/supplier-invoices/${invoiceId}/returns`,
          {
            reason: f.get("reason"),
            items: invoice.data.data.receipt.items
              .map((i: Row) => ({
                receiptItemId: i.id,
                quantity: Number(f.get(i.id)),
              }))
              .filter((i: Row) => i.quantity > 0),
          },
          crypto.randomUUID(),
        ),
      () => {
        setInvoiceId(null);
        setReturning(false);
      },
    );
  }
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">A&Z • حساب المورد</div>
          <h1>{data?.supplier.name ?? "حساب المورد"}</h1>
          <p>
            {data?.supplier.phone} {data?.supplier.address}
          </p>
        </div>
        <div className="head-actions">
          <Link className="btn btn-outline" to="/suppliers">
            الموردون
          </Link>
          <Button
            onClick={() => setPayment(true)}
            disabled={!data || Number(data.summary.balance) <= 0}
          >
            <Wallet size={17} />
            تسجيل سداد
          </Button>
        </div>
      </div>
      <Status error={action.error} message={action.message} />
      {data && (
        <div className="stat-grid">
          {[
            { label: "فواتير الاستلام", value: data.summary.invoiced },
            { label: "السداد للمورد", value: data.summary.paid },
            { label: "مرتجعات المشتريات", value: data.summary.returned },
            {
              label:
                Number(data.summary.balance) < 0
                  ? "رصيد لصالح المتجر"
                  : "المستحق للمورد",
              value: String(Math.abs(Number(data.summary.balance))),
            },
          ].map((c, i) => (
            <section
              className={`stat-card ${i === 3 ? "featured" : ""}`}
              key={c.label}
            >
              <div className="stat-top">{c.label}</div>
              <strong>{fm(c.value)}</strong>
              <small>
                {i === 3
                  ? `يشمل رصيدًا افتتاحيًا ${fm(data.summary.openingBalance)}`
                  : "حركات الحساب المسجلة"}
              </small>
            </section>
          ))}
        </div>
      )}
      <section className="panel">
        <div className="tabs">
          {[
            ["statement", "كشف الحساب"],
            ["invoices", "فواتير المورد"],
            ["returns", "مرتجعات المشتريات"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              onClick={() => {
                setTab(key!);
                setOffset(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <DataState
          loading={loading}
          error={error}
          retry={() =>
            void (tab === "statement"
              ? statement.refetch()
              : documents.refetch())
          }
        />
        {!loading && !error && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  {tab === "statement" ? (
                    <tr>
                      <th>التاريخ</th>
                      <th>نوع الحركة</th>
                      <th>المرجع / الملاحظات</th>
                      <th>زيادة المديونية</th>
                      <th>تخفيض المديونية</th>
                      <th>الرصيد بعد الحركة</th>
                    </tr>
                  ) : (
                    <tr>
                      <th>المستند</th>
                      <th>التاريخ</th>
                      <th>الإجمالي</th>
                      <th>
                        {tab === "invoices"
                          ? "المرتجع من الفاتورة"
                          : "سبب المرتجع"}
                      </th>
                      <th>الإجراءات</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {rows.map((r: Row) => (
                    <tr key={r.id}>
                      {tab === "statement" ? (
                        <>
                          <td>
                            {r.type === "OPENING"
                              ? "—"
                              : formatDate(r.createdAt)}
                          </td>
                          <td>{names[r.type]}</td>
                          <td>
                            {r.reference || "—"}
                            {!["OPENING", "INVOICE"].includes(r.type) && (
                              <small>{r.description}</small>
                            )}
                          </td>
                          <td>{Number(r.debit) ? fm(r.debit) : "—"}</td>
                          <td>{Number(r.credit) ? fm(r.credit) : "—"}</td>
                          <td>
                            <strong>{fm(r.balance)}</strong>
                          </td>
                        </>
                      ) : (
                        <>
                          <td>
                            <strong>
                              {tab === "invoices" ? "فاتورة" : "مرتجع"} #
                              {r.number}
                            </strong>
                          </td>
                          <td>{formatDate(r.createdAt)}</td>
                          <td>{fm(r.total)}</td>
                          <td>
                            {tab === "invoices"
                              ? fm(
                                  r.returns.reduce(
                                    (s: number, v: Row) => s + Number(v.total),
                                    0,
                                  ),
                                )
                              : r.reason}
                          </td>
                          <td>
                            <Button
                              variant="outline"
                              onClick={() => {
                                setInvoiceId(
                                  tab === "invoices" ? r.id : r.invoiceId,
                                );
                                setReturning(false);
                              }}
                            >
                              تفاصيل الفاتورة
                            </Button>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rows.length && (
                <div className="empty">لا توجد حركات في هذا القسم.</div>
              )}
            </div>
            <Pager
              offset={offset}
              setOffset={setOffset}
              length={rows.length}
              total={
                tab === "statement"
                  ? (data?.total ?? 0)
                  : (documents.data?.total ?? 0)
              }
            />
          </>
        )}
      </section>
      <p className="note">
        المديونية = الرصيد الافتتاحي + فواتير الاستلام − السداد − مرتجعات
        المشتريات. السداد مسجل على إجمالي حساب المورد.
      </p>
      <Modal
        title="تسجيل سداد للمورد"
        open={payment}
        close={() => setPayment(false)}
      >
        <p className="note">
          المستحق حاليًا: {fm(data?.summary.balance)}. لا يسمح بسداد أكثر من
          الرصيد المستحق.
        </p>
        <form onSubmit={pay}>
          <Field label="مبلغ السداد">
            {(id) => (
              <input
                id={id}
                type="number"
                min="0.01"
                step="0.01"
                max={data?.summary.balance}
                name="amount"
                required
              />
            )}
          </Field>
          <Field label="طريقة السداد">
            {(id) => (
              <select
                id={id}
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                <option value="BANK">تحويل بنكي</option>
                <option value="WALLET">محفظة إلكترونية</option>
                <option value="CARD">بطاقة — تسجيل دفع خارجي</option>
                <option value="CASH">نقدي من درج الكاشير</option>
              </select>
            )}
          </Field>
          {method === "CASH" && (
            <p className="notice">
              {shift.data?.data
                ? "سيُخصم المبلغ من ورديتك المفتوحة."
                : "افتح وردية أولًا لتسجيل سداد نقدي."}
            </p>
          )}
          <Field label="مرجع التحويل / السداد (اختياري)">
            {(id) => <input id={id} name="reference" maxLength={200} />}
          </Field>
          <Field label="ملاحظات السداد">
            {(id) => <textarea id={id} name="notes" maxLength={1000} />}
          </Field>
          <Status busy={action.busy} error={action.error} />
          <Button
            disabled={action.busy || (method === "CASH" && !shift.data?.data)}
          >
            تأكيد السداد
          </Button>
        </form>
      </Modal>
      <Modal
        title={
          returning
            ? "مرتجع مشتريات"
            : `فاتورة مورد #${invoice.data?.data.number ?? ""}`
        }
        open={!!invoiceId}
        close={() => {
          setInvoiceId(null);
          setReturning(false);
        }}
      >
        <DataState
          loading={invoice.isLoading}
          error={invoice.error}
          retry={() => void invoice.refetch()}
        />
        {invoice.data && (
          <>
            {!returning ? (
              <>
                <div className="head-actions supplier-invoice-actions">
                  <Link
                    className="btn btn-outline"
                    to={`/products/barcodes?receiptId=${invoice.data.data.receiptId}`}
                  >
                    <Printer size={16} />
                    باركود هذه الدفعة
                  </Link>
                  {canReturn &&
                    invoice.data.data.receipt.items.some(
                      (i: Row) => i.returned < i.quantity,
                    ) && (
                      <Button
                        variant="outline"
                        onClick={() => setReturning(true)}
                      >
                        <RotateCcw size={16} />
                        مرتجع للمورد
                      </Button>
                    )}
                </div>
                <p className="note">
                  المخزن: {invoice.data.data.receipt.purchase.location.name} •{" "}
                  {formatDate(invoice.data.data.createdAt)}
                </p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>الصنف</th>
                        <th>المستلم</th>
                        <th>المرتجع</th>
                        <th>تكلفة الوحدة</th>
                        <th>إجمالي السطر</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoice.data.data.receipt.items.map((i: Row) => (
                        <tr key={i.id}>
                          <td>
                            <strong>
                              {i.purchaseItem.variant.product.nameAr}
                            </strong>
                            <small>
                              {Object.values(
                                i.purchaseItem.variant.options,
                              ).join(" / ") || i.purchaseItem.variant.sku}
                            </small>
                          </td>
                          <td>{i.quantity}</td>
                          <td>{i.returned}</td>
                          <td>{fm(i.unitCost)}</td>
                          <td>{fm(i.lineTotal)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="grand-total">
                  <span>إجمالي الفاتورة</span>
                  <strong>{fm(invoice.data.data.total)}</strong>
                </div>
              </>
            ) : (
              <form onSubmit={returnItems}>
                <p className="notice">
                  سيتم خصم القطع من مخزن الاستلام وتخفيض حساب المورد بقيمتها
                  الأصلية، دون تسجيل رد نقدي.
                </p>
                {invoice.data.data.receipt.items
                  .filter((i: Row) => i.returned < i.quantity)
                  .map((i: Row) => (
                    <Field
                      key={i.id}
                      label={`${i.purchaseItem.variant.product.nameAr} • ${Object.values(i.purchaseItem.variant.options).join(" / ")} • المتبقي ${i.quantity - i.returned}`}
                    >
                      {(id) => (
                        <input
                          id={id}
                          name={i.id}
                          type="number"
                          min="0"
                          max={i.quantity - i.returned}
                          step="1"
                          defaultValue="0"
                        />
                      )}
                    </Field>
                  ))}
                <Field label="سبب مرتجع المشتريات">
                  {(id) => (
                    <textarea
                      id={id}
                      name="reason"
                      required
                      minLength={3}
                      maxLength={1000}
                    />
                  )}
                </Field>
                <Status busy={action.busy} error={action.error} />
                <Button disabled={action.busy}>اعتماد مرتجع المشتريات</Button>
              </form>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
