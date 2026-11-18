import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ScanBarcode,
  Search,
  ShoppingBag,
  Plus,
  Minus,
  Check,
} from "lucide-react";
import { api, ApiError, post, useSession } from "../../api";
import { formatMoney as fm } from "../../i18n";
import { Button } from "../../components/ui/button";
import { Field, Header, Modal, ErrorMessage } from "../shared/Controls";
import { ReceiptView } from "../receipts/ReceiptView";
import {
  PaymentEditor,
  resolvedPayments,
  type PaymentDraft,
} from "./PaymentEditor";
import { cents, previewTotals, decimal } from "./money";
import { usePosWorkspace } from "./usePosWorkspace";
import { emptyDraft, type CartDraft } from "./workspace";
import { approvalError } from "./approval-messages";
import { CustomerPicker } from "../customers/CustomerPicker";
import { useDebouncedSearch } from "../../hooks/useDebouncedSearch";
type Row = Record<string, any>;
export function POS() {
  const client = useQueryClient(),
    user = useSession((s) => s.user),
    [code, setCode] = useState(""),
    [q, setQ] = useState(""),
    [resumeId, setResumeId] = useState(""),
    [approvalReason, setApprovalReason] = useState(""),
    [receipt, setReceipt] = useState<Row | null>(null),
    [scanning, setScanning] = useState(false),
    [busy, setBusy] = useState(false),
    [customerBusy, setCustomerBusy] = useState(false),
    [error, setError] = useState("");
  const { workspace, commit, ready, storageError } = usePosWorkspace(user!.id);
  const { debounced: debouncedQ, searchPending } = useDebouncedSearch(q);
  const inFlight = useRef(false);
  const scanInput = useRef<HTMLInputElement>(null);
  const { discount, discountType, itemDiscounts, payments, customer, notes } =
    workspace.active;
  const suspended = workspace.suspended,
    pending = workspace.pending;
  const frozen =
    busy ||
    customerBusy ||
    scanning ||
    !ready ||
    !!pending ||
    !!workspace.receiptId;
  useEffect(() => {
    if (!frozen) scanInput.current?.focus();
  }, [ready, scanning]);
  function field<K extends keyof CartDraft>(
    name: K,
    value: CartDraft[K] | ((old: CartDraft[K]) => CartDraft[K]),
  ) {
    commit((w) =>
      w.pending || w.receiptId
        ? w
        : {
            ...w,
            active: {
              ...w.active,
              ...(name !== "payments" &&
              name !== "discountApprovalId" &&
              name !== "customerSearch" &&
              name !== "customerNameDraft"
                ? { discountApprovalId: undefined }
                : {}),
              [name]:
                typeof value === "function" ? value(w.active[name]) : value,
            },
          },
    );
  }
  const setDiscount = (v: string) => field("discount", v),
    setDiscountType = (v: "FIXED" | "PERCENT") => field("discountType", v),
    setItemDiscounts = (
      v:
        | CartDraft["itemDiscounts"]
        | ((old: CartDraft["itemDiscounts"]) => CartDraft["itemDiscounts"]),
    ) => field("itemDiscounts", v),
    setPayments = (v: PaymentDraft[]) => field("payments", v),
    setCustomer = (v: string) => {
      field("loyaltyPoints", 0);
      field("customer", v);
    },
    setNotes = (v: string) => field("notes", v);
  const cart = {
    items: workspace.active.items,
    add: (v: any) =>
      field("items", (rows) =>
        rows.some((i) => i.variant.id === v.id)
          ? rows.map((i) =>
              i.variant.id === v.id ? { ...i, quantity: i.quantity + 1 } : i,
            )
          : [
              ...rows,
              {
                variant: {
                  id: v.id,
                  sku: v.sku,
                  barcode: v.barcode,
                  price: String(v.price),
                  options: v.options ?? {},
                  product: { nameAr: v.product?.nameAr ?? v.sku },
                },
                quantity: 1,
              },
            ],
      ),
    quantity: (id: string, quantity: number) =>
      field("items", (rows) =>
        rows
          .map((i) => (i.variant.id === id ? { ...i, quantity } : i))
          .filter((i) => i.quantity > 0),
      ),
  };
  const products = useQuery({
      queryKey: ["pos-products", debouncedQ],
      queryFn: ({ signal }) =>
        api(`/products?q=${encodeURIComponent(debouncedQ)}`, { signal }),
      enabled: !searchPending,
    }),
    shift = useQuery({
      queryKey: ["pos-shift"],
      queryFn: () => api("/shifts/current"),
    }),
    store = useQuery({ queryKey: ["pos-store"], queryFn: () => api("/store") });
  const items = cart.items.map((i) => ({
    variantId: i.variant.id,
    quantity: i.quantity,
    discount: itemDiscounts[i.variant.id]?.value || "0",
    discountType: itemDiscounts[i.variant.id]?.type ?? "FIXED",
  }));
  const pricingInput = {
    ...(workspace.active.loyaltyPoints
      ? { loyaltyPoints: workspace.active.loyaltyPoints }
      : {}),
    ...(workspace.active.discountApprovalId
      ? { discountApprovalId: workspace.active.discountApprovalId }
      : {}),
    ...(customer ? { customerId: customer } : {}),
    notes,
    shiftId: shift.data?.data?.id,
    items,
    discount: discount || "0",
    discountType,
    payments: [{ method: "CASH", amount: "0" }],
  };
  const approval = useQuery({
    queryKey: ["pos-discount-approval", workspace.active.discountApprovalId],
    queryFn: async () => ({
      ...(await api(
        `/discount-approvals/${workspace.active.discountApprovalId}`,
      )),
      checkedAt: Date.now(),
    }),
    enabled: !!workspace.active.discountApprovalId,
    refetchInterval: 5000,
  });
  const quote = useQuery({
    queryKey: [
      "pos-quote",
      pricingInput,
      approval.data?.data.status,
      !!approval.data && new Date(approval.data.data.expiresAt) < new Date(),
    ],
    queryFn: ({ signal }) =>
      api("/sales/quote", {
        method: "POST",
        body: JSON.stringify(pricingInput),
        signal,
      }),
    enabled: !!shift.data?.data && cart.items.length > 0,
    retry: false,
  });
  const local = previewTotals(
      cart.items,
      itemDiscounts,
      discount || "0",
      discountType,
      store.data?.data.taxRate ?? "0",
      store.data?.data.taxMode ?? "EXCLUSIVE",
    ),
    summary = quote.data
      ? {
          subtotal: cents(quote.data.data.subtotal),
          discount: cents(quote.data.data.discount),
          net: cents(quote.data.data.netBeforeTax),
          tax: cents(quote.data.data.tax),
          total: cents(quote.data.data.total),
        }
      : local;
  const currentPrice = (item: CartDraft["items"][number]) =>
    quote.data?.data.items?.find(
      (line: Row) => line.variantId === item.variant.id,
    )?.unitPrice ?? item.variant.price;
  useEffect(() => {
    if (!ready || !workspace.receiptId) return;
    let ignore = false;
    void api(`/sales/${workspace.receiptId}`)
      .then((r) => {
        if (!ignore) setReceipt(r.data);
      })
      .catch((e) => {
        if (!ignore) setError(e.message);
      });
    return () => {
      ignore = true;
    };
  }, [ready, workspace.receiptId]);
  function clear() {
    commit((w) => ({ ...w, active: emptyDraft() }));
    setError("");
  }
  async function scan(e: FormEvent) {
    e.preventDefault();
    if (frozen || !code.trim()) return;
    const scanned = code.trim();
    setCode("");
    setScanning(true);
    try {
      const r = await api(`/barcodes/${encodeURIComponent(scanned)}/lookup`, {
        signal: AbortSignal.timeout(15000),
      });
      cart.add(r.data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "الباركود غير موجود");
    } finally {
      setScanning(false);
    }
  }
  async function complete() {
    if (frozen || inFlight.current) return;
    if (!customer) {
      setError("حدد رقم العميل قبل إتمام البيع، حتى مع الدفع النقدي");
      return;
    }
    const attempt = {
      key: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      body: {
        requireCustomer: true as const,
        ...(workspace.active.loyaltyPoints
          ? { loyaltyPoints: workspace.active.loyaltyPoints }
          : {}),
        ...(workspace.active.discountApprovalId
          ? { discountApprovalId: workspace.active.discountApprovalId }
          : {}),
        shiftId: shift.data?.data?.id,
        items,
        discount: discount || "0",
        discountType,
        payments: resolvedPayments(payments, summary.total),
        ...(customer ? { customerId: customer } : {}),
        notes,
      },
    };
    if (!commit((w) => ({ ...w, pending: attempt }))) return;
    await recover(attempt, "retry");
  }
  async function acceptSale(sale: Row) {
    if (
      !commit((w) => ({
        ...w,
        active: emptyDraft(),
        pending: null,
        receiptId: sale.id,
      }))
    )
      return;
    setReceipt(sale);
    await client.invalidateQueries();
  }
  async function recover(
    attempt = pending,
    action: "check" | "retry" | "cancel" = "check",
  ) {
    if (!attempt || inFlight.current || !ready) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      if (action === "retry") {
        const r = await api(
          "/sales",
          {
            method: "POST",
            body: JSON.stringify(attempt.body),
            signal: AbortSignal.timeout(20000),
          },
          attempt.key,
        );
        await acceptSale(r.data);
      } else {
        const r = await api(
          `/checkout-attempts/${attempt.key}${action === "cancel" ? "/cancel" : ""}`,
          {
            ...(action === "cancel" ? { method: "POST", body: "{}" } : {}),
            signal: AbortSignal.timeout(20000),
          },
        );
        if (r.data.status === "COMPLETED") {
          const sale = await api(`/sales/${r.data.saleId}`);
          await acceptSale(sale.data);
        } else if (r.data.status === "CANCELLED") {
          commit((w) => ({ ...w, pending: null }));
          setError(
            "تم تأكيد إلغاء المحاولة. السلة محفوظة ويمكن تعديلها والمحاولة من جديد.",
          );
        } else
          setError(
            "لم تظهر فاتورة مسجلة لهذه المحاولة. أعد إرسال نفس المحاولة أو ألغها بأمان قبل تعديل السلة.",
          );
      }
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === "DISCOUNT_LIMIT"
          ? "الخصم يتجاوز الحد المسموح لحسابك. يلزم اعتماد مستخدم بصلاحية مناسبة."
          : e instanceof ApiError
            ? approvalError(e)
            : "تعذر تأكيد نتيجة البيع بسبب الاتصال. السلة ومحاولة البيع محفوظتان؛ استخدم التحقق أو إعادة إرسال نفس المحاولة.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (ready && pending) void recover(pending, "check");
    // Check on hydration; later attempts are sent explicitly by complete().
  }, [ready]);
  return (
    <>
      <Header
        title="نقطة البيع"
        subtitle="امسح الباركود، راجع الفاتورة ووزّع المبلغ على طرق الدفع."
      >
        <Link className="btn btn-outline" to="/shifts">
          {shift.data?.data ? "الوردية مفتوحة" : "افتح وردية أولًا"}
        </Link>
        <Link className="btn btn-outline" to="/sales">
          سجل المبيعات
        </Link>
      </Header>
      {!shift.isLoading && !shift.data?.data && (
        <div className="notice">
          يجب فتح وردية قبل إتمام البيع.{" "}
          <Link to="/shifts">إدارة الورديات</Link>
        </div>
      )}
      <ErrorMessage message={error} />
      <ErrorMessage message={storageError} />
      {!ready && !storageError && (
        <div className="notice">جارٍ استرجاع السلة المحفوظة...</div>
      )}
      {pending && (
        <div className="notice" role="status">
          <p>
            توجد محاولة بيع تحتاج تأكيد النتيجة. السلة مقفولة لحين استرجاع
            الفاتورة أو تأكيد الإلغاء.
          </p>
          <Button
            disabled={busy || !ready}
            onClick={() => void recover(pending, "check")}
          >
            التحقق من نتيجة البيع
          </Button>{" "}
          <Button
            disabled={busy || !ready}
            onClick={() => void recover(pending, "retry")}
          >
            إعادة إرسال نفس المحاولة
          </Button>{" "}
          <Button
            variant="outline"
            disabled={busy || !ready}
            onClick={() => void recover(pending, "cancel")}
          >
            إلغاء المحاولة بأمان
          </Button>
        </div>
      )}
      {workspace.receiptId && !receipt && (
        <div className="notice">
          البيع محفوظ.{" "}
          <Button
            disabled={busy || !ready}
            onClick={() => {
              void api(`/sales/${workspace.receiptId}`)
                .then((r) => setReceipt(r.data))
                .catch((e) => setError(e.message));
            }}
          >
            استرجاع الفاتورة
          </Button>
        </div>
      )}
      <fieldset
        disabled={frozen}
        style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
      >
        <div className="pos-grid">
          <section className="panel pos-catalog">
            <form className="scanner" onSubmit={scan}>
              <ScanBarcode size={24} />
              <input
                ref={scanInput}
                autoFocus
                aria-label="مسح الباركود"
                placeholder="امسح الباركود ثم اضغط Enter"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={busy}
              />
              <Button disabled={busy}>إضافة</Button>
            </form>
            <div className="search">
              <Search size={18} />
              <input
                aria-label="بحث المنتجات"
                placeholder="ابحث بالاسم أو الكود..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            {searchPending || products.isLoading ? (
              <p className="barcode-help">جارٍ تحميل المنتجات...</p>
            ) : products.error ? (
              <div className="empty">
                <p>تعذر تحميل المنتجات.</p>
                <Button
                  variant="outline"
                  onClick={() => void products.refetch()}
                >
                  إعادة المحاولة
                </Button>
              </div>
            ) : (
              <div className="catalog-grid">
                {products.data?.data.flatMap((p: Row) =>
                  p.variants
                    .filter((v: Row) => v.active && p.status === "ACTIVE")
                    .map((v: Row) => (
                      <button
                        disabled={busy}
                        className="catalog-item"
                        key={v.id}
                        onClick={() =>
                          cart.add({ ...v, product: { nameAr: p.nameAr } })
                        }
                      >
                        <div className="catalog-art">
                          <ShoppingBag size={32} />
                          <span>{p.category.name}</span>
                        </div>
                        <strong>{p.nameAr}</strong>
                        <small>
                          {Object.values(v.options).join(" / ") || v.sku}
                        </small>
                        <div>
                          <b>{fm(v.price)}</b>
                          <span className="add-circle">
                            <Plus size={16} />
                          </span>
                        </div>
                      </button>
                    )),
                )}
              </div>
            )}
          </section>
          <section className="panel cart">
            <div className="panel-title">
              <h2>
                الفاتورة الحالية{" "}
                <span className="count">{cart.items.length}</span>
              </h2>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (
                    cart.items.length &&
                    window.confirm("مسح جميع عناصر السلة؟")
                  )
                    clear();
                }}
              >
                مسح
              </Button>
            </div>
            <div className="cart-items">
              {cart.items.length ? (
                cart.items.map((i) => (
                  <div className="cart-line-wrapper" key={i.variant.id}>
                    <div className="cart-line">
                      <div>
                        <strong>{i.variant.product?.nameAr}</strong>
                        <small>
                          {Object.values(i.variant.options ?? {}).join(" / ")}
                        </small>
                        <b>{fm(currentPrice(i))}</b>
                      </div>
                      <div className="qty">
                        <button
                          disabled={busy}
                          aria-label="تقليل الكمية"
                          onClick={() =>
                            cart.quantity(i.variant.id, i.quantity - 1)
                          }
                        >
                          <Minus size={14} />
                        </button>
                        <span>{i.quantity}</span>
                        <button
                          disabled={busy}
                          aria-label="زيادة الكمية"
                          onClick={() =>
                            cart.quantity(i.variant.id, i.quantity + 1)
                          }
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                      <strong>
                        {fm(
                          decimal(cents(currentPrice(i)) * BigInt(i.quantity)),
                        )}
                      </strong>
                    </div>
                    <div className="line-discount-fields">
                      <label>
                        خصم الصنف{" "}
                        <input
                          aria-label={`خصم ${i.variant.sku}`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={itemDiscounts[i.variant.id]?.value ?? "0"}
                          onChange={(e) =>
                            setItemDiscounts((old) => ({
                              ...old,
                              [i.variant.id]: {
                                type: old[i.variant.id]?.type ?? "FIXED",
                                value: e.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                      <select
                        aria-label={`نوع خصم ${i.variant.sku}`}
                        value={itemDiscounts[i.variant.id]?.type ?? "FIXED"}
                        onChange={(e) =>
                          setItemDiscounts((old) => ({
                            ...old,
                            [i.variant.id]: {
                              value: old[i.variant.id]?.value ?? "0",
                              type: e.target.value as "FIXED" | "PERCENT",
                            },
                          }))
                        }
                      >
                        <option value="FIXED">جنيه على السطر</option>
                        <option value="PERCENT">نسبة %</option>
                      </select>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty">
                  <ShoppingBag size={30} />
                  <p>امسح منتجًا لبدء الفاتورة.</p>
                </div>
              )}
            </div>
            <div className="cart-bottom">
              <CustomerPicker
                value={customer}
                search={workspace.active.customerSearch ?? ""}
                name={workspace.active.customerNameDraft ?? ""}
                disabled={frozen}
                onSearch={(text) => field("customerSearch", text)}
                onName={(text) => field("customerNameDraft", text)}
                onSelect={(selected) => setCustomer(selected?.id ?? "")}
                onBusyChange={setCustomerBusy}
              />
              <div className="summary-row">
                <span>الإجمالي قبل الخصم</span>
                <b>{fm(decimal(summary.subtotal))}</b>
              </div>
              <div className="payment-grid">
                <Field label="خصم على الفاتورة">
                  {(id) => (
                    <input
                      id={id}
                      type="number"
                      min="0"
                      step="0.01"
                      value={discount}
                      onChange={(e) => setDiscount(e.target.value)}
                    />
                  )}
                </Field>
                <Field label="نوع خصم الفاتورة">
                  {(id) => (
                    <select
                      id={id}
                      value={discountType}
                      onChange={(e) =>
                        setDiscountType(e.target.value as "FIXED" | "PERCENT")
                      }
                    >
                      <option value="FIXED">مبلغ ثابت بالجنيه</option>
                      <option value="PERCENT">نسبة مئوية %</option>
                    </select>
                  )}
                </Field>
              </div>
              <small>
                حد الخصم الإجمالي لحسابك: {user?.discountLimit ?? "0"}%
              </small>
              <div className="summary-row">
                <span>الصافي قبل الضريبة</span>
                <b>{fm(decimal(summary.net))}</b>
              </div>
              <div className="summary-row">
                <span>
                  ضريبة القيمة المضافة (
                  {quote.data?.data.taxRate ?? store.data?.data.taxRate ?? 0}%)
                </span>
                <b>{fm(decimal(summary.tax))}</b>
              </div>
              <div className="grand-total">
                <span>الإجمالي النهائي المستحق</span>
                <strong>{fm(decimal(summary.total))}</strong>
              </div>
              {quote.error && (
                <ErrorMessage
                  message={
                    quote.error instanceof ApiError &&
                    quote.error.code === "DISCOUNT_LIMIT"
                      ? "الخصم يتجاوز الحد المسموح لحسابك."
                      : quote.error instanceof Error
                        ? approvalError(quote.error)
                        : "تعذر مراجعة الفاتورة"
                  }
                />
              )}
              {quote.data?.data.promotion && (
                <div className="notice" role="status">
                  <div>
                    <b>{quote.data.data.promotion.name}</b>
                    <p>
                      خصم العرض التلقائي:{" "}
                      {fm(quote.data.data.automaticDiscount)}. الخصومات اليدوية
                      تُحسب بعد العرض.
                    </p>
                    {quote.data.data.promotion.returnRule === "FULL_BUNDLE" && (
                      <small>
                        إرجاع أو استبدال العرض يتطلب جميع أصنافه معًا بالقيمة
                        المدفوعة.
                      </small>
                    )}
                  </div>
                </div>
              )}
              {workspace.active.discountApprovalId && (
                <div className="notice" role="status">
                  {approval.data &&
                  new Date(approval.data.data.expiresAt) < new Date()
                    ? "انتهت صلاحية طلب الخصم. أزل الطلب واطلب موافقة جديدة."
                    : approval.data?.data.status === "APPROVED"
                      ? "المدير وافق على الخصم لهذه السلة. الموافقة تُراجع عند إتمام البيع."
                      : approval.data?.data.status === "REJECTED"
                        ? `تم رفض الخصم: ${approval.data.data.decisionNote}`
                        : approval.data?.data.status === "CONSUMED"
                          ? "هذه الموافقة استُخدمت بالفعل."
                          : "طلب الخصم قيد المراجعة. تتم متابعة النتيجة تلقائيًا."}
                  <Button
                    variant="ghost"
                    onClick={() => field("discountApprovalId", undefined)}
                  >
                    إزالة الطلب
                  </Button>
                </div>
              )}
              {quote.error instanceof ApiError &&
                [
                  "DISCOUNT_LIMIT",
                  "DISCOUNT_APPROVAL_INVALID",
                  "DISCOUNT_APPROVAL_CHANGED",
                ].includes(quote.error.code) &&
                !workspace.active.discountApprovalId && (
                  <div>
                    <Field label="سبب تجاوز حد الخصم">
                      {(id) => (
                        <input
                          id={id}
                          value={approvalReason}
                          maxLength={1000}
                          onChange={(e) => setApprovalReason(e.target.value)}
                          placeholder="اكتب سبب طلب الخصم الاستثنائي"
                        />
                      )}
                    </Field>
                    <Button
                      variant="outline"
                      disabled={frozen || approvalReason.trim().length < 3}
                      onClick={() => {
                        setBusy(true);
                        setError("");
                        void post(
                          "/discount-approvals",
                          { sale: pricingInput, reason: approvalReason },
                          crypto.randomUUID(),
                        )
                          .then((r) => field("discountApprovalId", r.data.id))
                          .catch((e) => setError(approvalError(e)))
                          .finally(() => setBusy(false));
                      }}
                    >
                      طلب موافقة المدير
                    </Button>
                  </div>
                )}
              {customer && (
                <div>
                  <Field label="نقاط الولاء للاستبدال">
                    {(id) => (
                      <input
                        id={id}
                        type="number"
                        min="0"
                        max="1000000"
                        step="1"
                        value={workspace.active.loyaltyPoints ?? 0}
                        disabled={frozen}
                        onChange={(e) =>
                          field(
                            "loyaltyPoints",
                            Math.max(
                              0,
                              Math.min(
                                1000000,
                                Math.trunc(Number(e.target.value) || 0),
                              ),
                            ),
                          )
                        }
                      />
                    )}
                  </Field>
                  {quote.data?.data.loyalty && (
                    <p className="note">
                      {quote.data.data.loyalty.enabled
                        ? `المتاح: ${quote.data.data.loyalty.available} نقطة • المكتسب من الفاتورة: ${quote.data.data.loyalty.earned} نقطة • خصم النقاط: ${fm(quote.data.data.loyalty.discount)}`
                        : "برنامج الولاء غير مفعّل."}
                    </p>
                  )}
                </div>
              )}
              <PaymentEditor
                value={payments}
                onChange={setPayments}
                due={summary.total}
                disabled={busy}
              />
              <Field label="ملاحظات">
                {(id) => (
                  <input
                    id={id}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                )}
              </Field>
              <Button
                className="full"
                disabled={
                  frozen ||
                  !customer ||
                  !cart.items.length ||
                  !shift.data?.data ||
                  summary.total < 0n ||
                  quote.isLoading ||
                  !!quote.error
                }
                onClick={() => void complete()}
              >
                <Check size={18} />
                {busy ? "جارٍ تسجيل البيع..." : "إتمام البيع"}
              </Button>
              {suspended.length > 1 && (
                <Field label="اختر سلة معلّقة">
                  {(id) => (
                    <select
                      id={id}
                      value={resumeId}
                      onChange={(e) => setResumeId(e.target.value)}
                    >
                      <option value="">آخر سلة معلّقة</option>
                      {suspended.map((saved) => (
                        <option key={saved.id} value={saved.id}>
                          {new Date(saved.savedAt).toLocaleString("ar-EG")} —{" "}
                          {saved.items.reduce((n, i) => n + i.quantity, 0)} قطع
                          {saved.notes ? ` — ${saved.notes.slice(0, 40)}` : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              )}
              <div className="suspend">
                <Button
                  variant="outline"
                  disabled={
                    !cart.items.length || busy || suspended.length >= 50
                  }
                  onClick={() => {
                    commit((w) => ({
                      ...w,
                      suspended: [
                        ...w.suspended,
                        {
                          ...w.active,
                          id: crypto.randomUUID(),
                          savedAt: new Date().toISOString(),
                        },
                      ],
                      active: emptyDraft(),
                    }));
                  }}
                >
                  تعليق السلة
                </Button>
                {suspended.length > 0 && (
                  <Button
                    variant="outline"
                    disabled={!!cart.items.length || busy}
                    onClick={() => {
                      commit((w) => {
                        const saved =
                          w.suspended.find((s) => s.id === resumeId) ??
                          w.suspended.at(-1)!;
                        return {
                          ...w,
                          active: saved,
                          suspended: w.suspended.filter(
                            (s) => s.id !== saved.id,
                          ),
                        };
                      });
                      setResumeId("");
                    }}
                  >
                    استئناف ({suspended.length})
                  </Button>
                )}
              </div>
              <small className="note">
                السلال محفوظة لحسابك على نفس المتصفح والجهاز، ولا تحجز المخزون.{" "}
                السعر والضريبة والخصم تُراجع على الخادم، وكل فاتورة تحتفظ بنسخة
                ثابتة من حساباتها.
              </small>
            </div>
          </section>
        </div>
      </fieldset>
      <Modal
        title="تم البيع بنجاح"
        open={!!receipt}
        close={() => {
          if (commit((w) => ({ ...w, receiptId: null }))) setReceipt(null);
        }}
      >
        {receipt && <ReceiptView sale={receipt} />}
      </Modal>
    </>
  );
}
