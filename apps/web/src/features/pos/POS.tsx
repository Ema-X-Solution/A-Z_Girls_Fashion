import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ProductImage } from "../shared/ProductImage";
import {
  ScanBarcode,
  Search,
  ShoppingBag,
  Plus,
  Minus,
  Check,
  Users,
  CreditCard,
  ReceiptText,
  Trash2,
} from "lucide-react";
import { checkoutSchema } from "@az/shared";
import { api, ApiError, post, useSession } from "../../api";
import { formatDigits, formatMoney as fm } from "../../i18n";
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
import "./pos.css";
type Row = Record<string, any>;
export function POS() {
  const client = useQueryClient(),
    user = useSession((s) => s.user),
    [code, setCode] = useState(""),
    [q, setQ] = useState(""),
    [approvalReason, setApprovalReason] = useState(""),
    [receipt, setReceipt] = useState<Row | null>(null),
    [scanning, setScanning] = useState(false),
    [busy, setBusy] = useState(false),
    [customerBusy, setCustomerBusy] = useState(false),
    [clearOpen, setClearOpen] = useState(false),
    [stockVariants, setStockVariants] = useState<Record<string, Row>>({}),
    [error, setError] = useState("");
  const { workspace, commit, ready, storageError } = usePosWorkspace(user!.id);
  const { debounced: debouncedQ, searchPending } = useDebouncedSearch(q);
  const inFlight = useRef(false);
  const scanInput = useRef<HTMLInputElement>(null);
  const { discount, discountType, itemDiscounts, payments, customer, notes } =
    workspace.active;
  const selectedCashier = workspace.active.cashierId ?? "";
  const cashiers = useQuery({
    queryKey: ["pos-cashiers"],
    queryFn: () => api("/sales/cashiers"),
  });
  const pending = workspace.pending;
  const frozen =
    busy ||
    customerBusy ||
    scanning ||
    !ready ||
    !!pending ||
    !!workspace.receiptId ||
    clearOpen;
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
  function stockAtRegister(variant: Row | undefined): number | undefined {
    const locationId = shift.data?.data?.register?.locationId;
    if (!locationId || !variant || !Array.isArray(variant.balances)) return;
    return variant.balances.reduce(
      (sum: number, balance: Row) =>
        sum +
        (balance.locationId === locationId ? Number(balance.quantity) || 0 : 0),
      0,
    );
  }
  function canSetQuantity(variant: Row | undefined, quantity: number) {
    const available = stockAtRegister(variant);
    if (available === undefined) {
      setError(
        shift.data?.data
          ? "امسح باركود الصنف للتحقق من مخزونه في مكان البيع قبل زيادة الكمية."
          : "افتح وردية أولًا لتحديد مخزون مكان البيع.",
      );
      return false;
    }
    if (quantity > Math.min(available, 10000)) {
      setError(
        available <= 0
          ? "نفد مخزون هذا الصنف في مكان البيع."
          : `المتاح في مكان البيع ${available} قطعة. لا يمكن إضافة كمية أكبر من المتاح.`,
      );
      return false;
    }
    setError("");
    return true;
  }
  const cart = {
    items: workspace.active.items,
    add: (v: Row) => {
      const quantity =
        (workspace.active.items.find((i) => i.variant.id === v.id)?.quantity ??
          0) + 1;
      if (!canSetQuantity(v, quantity)) return false;
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
      );
      return true;
    },
    remove: (id: string) => {
      commit((w) => {
        if (w.pending || w.receiptId) return w;
        const discounts = { ...w.active.itemDiscounts };
        delete discounts[id];
        return {
          ...w,
          active: {
            ...w.active,
            items: w.active.items.filter((i) => i.variant.id !== id),
            itemDiscounts: discounts,
            discountApprovalId: undefined,
          },
        };
      });
      setError("");
    },
    quantity: (id: string, quantity: number) => {
      const old =
        workspace.active.items.find((i) => i.variant.id === id)?.quantity ?? 0;
      if (quantity <= 0) return cart.remove(id);
      if (quantity > old && !canSetQuantity(stockVariants[id], quantity))
        return;
      field("items", (rows) =>
        rows.map((i) => (i.variant.id === id ? { ...i, quantity } : i)),
      );
      setError("");
    },
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
  useEffect(() => {
    if (!products.data?.data) return;
    setStockVariants((old) => ({
      ...old,
      ...Object.fromEntries(
        products.data.data.flatMap((p: Row) =>
          p.variants.map((v: Row) => [v.id, v]),
        ),
      ),
    }));
  }, [products.data]);
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
    cashierId: selectedCashier || undefined,
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
        body: JSON.stringify({ ...pricingInput, previewOnly: true }),
        signal,
      }),
    enabled: !!shift.data?.data && cart.items.length > 0,
    retry: false,
  });
  const authorizationError = quote.data?.data.authorizationError;
  const quoteError =
    quote.error ??
    (authorizationError
      ? new ApiError(
          authorizationError.status,
          authorizationError.code,
          authorizationError.message,
        )
      : null);
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
  const checkoutInput = {
    ...pricingInput,
    requireCustomer: true as const,
    payments: resolvedPayments(payments, summary.total),
  };
  const validatedCheckout = checkoutSchema.safeParse(checkoutInput);
  const invalidField = validatedCheckout.success
    ? ""
    : String(validatedCheckout.error.issues[0]?.path[0] ?? "");
  const invalidMessage =
    invalidField === "payments"
      ? "راجع مبالغ الدفع وبيانات البطاقة قبل البيع."
      : invalidField === "discount" || invalidField === "items"
        ? "راجع الكميات والخصومات. اكتب مبالغ غير سالبة بمنزلتين عشريتين بحد أقصى."
        : "راجع بيانات الفاتورة قبل البيع.";
  const stockProblem = cart.items.find((item) => {
    const available = stockAtRegister(stockVariants[item.variant.id]);
    return available !== undefined && item.quantity > available;
  });
  const paid = checkoutInput.payments.reduce(
    (sum, payment) => sum + cents(payment.amount),
    0n,
  );
  const cash = checkoutInput.payments
    .filter((payment) => payment.method === "CASH")
    .reduce((sum, payment) => sum + cents(payment.amount), 0n);
  const checkoutBlockedReason = pending
    ? "تحقق من نتيجة محاولة البيع السابقة أو ألغها بأمان أولًا."
    : !ready
      ? "البيع متوقف لحين تأمين حفظ السلة على المتصفح."
      : busy
        ? "جارٍ مراجعة وتسجيل البيع..."
        : customerBusy || scanning
          ? "انتظر اكتمال العملية الحالية."
          : shift.isLoading
            ? "جارٍ التحقق من الوردية..."
            : !shift.data?.data
              ? "افتح وردية أولًا لإتمام البيع."
              : !selectedCashier ||
                  !cashiers.data?.data.some(
                    (c: Row) => c.id === selectedCashier,
                  )
                ? "اختر اسم الكاشير قبل إتمام البيع."
                : !cart.items.length
                  ? "أضف صنفًا إلى الفاتورة أولًا."
                  : !customer
                    ? "اختر العميل قبل إتمام البيع."
                    : stockProblem
                      ? "كمية أحد الأصناف أكبر من المتاح في مكان البيع. قلل الكمية أو احذف الصنف."
                      : !validatedCheckout.success
                        ? invalidMessage
                        : summary.total < 0n
                          ? "الخصم أكبر من قيمة الفاتورة. راجع الخصم."
                          : quote.isFetching
                            ? "جارٍ مراجعة أسعار الفاتورة والخصومات..."
                            : quoteError
                              ? approvalError(quoteError)
                              : paid < summary.total
                                ? "المبلغ المستلم أقل من المستحق. راجع الدفعات."
                                : paid - summary.total > cash
                                  ? "الزيادة في الدفع مسموحة نقدًا فقط. راجع الدفعات."
                                  : "";
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
    commit((w) => ({
      ...w,
      active: { ...emptyDraft(), cashierId: w.active.cashierId },
    }));
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
      setStockVariants((old) => ({ ...old, [r.data.id]: r.data }));
      cart.add(r.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "الباركود غير موجود");
    } finally {
      setScanning(false);
    }
  }
  async function complete() {
    if (frozen || inFlight.current) return;
    if (checkoutBlockedReason || !validatedCheckout.success) {
      setError(checkoutBlockedReason || invalidMessage);
      return;
    }
    // Quote and validate before journaling: a rejected preview is not a sale attempt.
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const latest = await api("/sales/quote", {
        method: "POST",
        body: JSON.stringify(validatedCheckout.data),
        signal: AbortSignal.timeout(15000),
      });
      if (cents(latest.data.total) !== summary.total) {
        await client.invalidateQueries({ queryKey: ["pos-quote"] });
        setError(
          "اتغير المبلغ المستحق. راجع الأسعار والدفعات قبل تأكيد البيع من جديد.",
        );
        return;
      }
    } catch (e) {
      setError(approvalError(e));
      return;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
    const attempt = {
      key: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      body: validatedCheckout.data,
    };
    if (!commit((w) => ({ ...w, pending: attempt }))) return;
    await recover(attempt, "retry");
  }
  async function acceptSale(sale: Row) {
    if (
      !commit((w) => ({
        ...w,
        active: { ...emptyDraft(), cashierId: w.active.cashierId },
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
    <div className="pos-page">
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
        className="pos-workspace"
        disabled={frozen}
        style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
      >
        <div className="pos-grid">
          <section className="panel pos-catalog">
            <div className="pos-catalog-heading">
              <div>
                <h2>اختيار المنتجات</h2>
                <p>ابحث عن الصنف أو امسح الباركود لإضافته</p>
              </div>
              <span className="pos-catalog-count">
                {products.data?.data.reduce(
                  (n: number, p: Row) =>
                    n +
                    p.variants.filter(
                      (v: Row) => v.active && p.status === "ACTIVE",
                    ).length,
                  0,
                ) ?? 0}{" "}
                أصناف
              </span>
            </div>
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
                    .map((v: Row) => {
                      const stockQty = stockAtRegister(v);
                      const isLow =
                        stockQty !== undefined && stockQty <= (v.minStock ?? 2);
                      const isOut = stockQty !== undefined && stockQty <= 0;
                      const inCart =
                        cart.items.find((i) => i.variant.id === v.id)
                          ?.quantity ?? 0;
                      const atLimit =
                        stockQty === undefined ||
                        inCart >= Math.min(stockQty, 10000);
                      return (
                        <button
                          disabled={frozen || atLimit}
                          title={
                            stockQty === undefined
                              ? "افتح وردية أولًا لتحديد مخزون مكان البيع"
                              : isOut
                                ? "نفد المخزون في مكان البيع"
                                : atLimit
                                  ? "تمت إضافة الكمية المتاحة بالكامل"
                                  : "إضافة إلى الفاتورة"
                          }
                          className="catalog-item"
                          key={v.id}
                          onClick={() =>
                            cart.add({ ...v, product: { nameAr: p.nameAr } })
                          }
                        >
                          <div className="catalog-art">
                            <ProductImage url={p.imageUrl} name={p.nameAr} />
                            <span>{p.category.name}</span>
                          </div>
                          <strong>{p.nameAr}</strong>
                          <small>
                            {formatDigits(
                              Object.values(v.options).join(" / "),
                            ) || v.sku}
                          </small>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              margin: "0.2rem 0",
                            }}
                          >
                            <span
                              style={{
                                padding: "0.15rem 0.45rem",
                                borderRadius: "4px",
                                fontSize: "0.75rem",
                                fontWeight: 600,
                                background: isOut
                                  ? "#fee2e2"
                                  : isLow
                                    ? "#fef3c7"
                                    : "#ecfdf5",
                                color: isOut
                                  ? "#dc2626"
                                  : isLow
                                    ? "#d97706"
                                    : "#059669",
                              }}
                            >
                              {stockQty === undefined
                                ? "افتح وردية لعرض المتاح"
                                : isOut
                                  ? "نفد المخزون في مكان البيع"
                                  : `المتاح هنا: ${stockQty} ق`}
                            </span>
                          </div>
                          <div>
                            <b>{fm(v.price)}</b>
                            <span className="add-circle">
                              <Plus size={16} />
                            </span>
                          </div>
                        </button>
                      );
                    }),
                )}
              </div>
            )}
          </section>
          <section className="panel cart">
            <div className="panel-title">
              <h2>
                الفاتورة الحالية{" "}
                <span className="count">
                  {cart.items.reduce((n, i) => n + i.quantity, 0)} قطع
                </span>
              </h2>
              <Button
                variant="ghost"
                disabled={frozen || !cart.items.length}
                onClick={() => setClearOpen(true)}
              >
                <Trash2 size={14} />
                مسح
              </Button>
            </div>
            <div className="pos-cart-scroll">
              <div className="cart-items">
                {cart.items.length ? (
                  cart.items.map((i) => (
                    <div className="cart-line-wrapper" key={i.variant.id}>
                      <div className="cart-line">
                        <div>
                          <strong>{i.variant.product?.nameAr}</strong>
                          <small>
                            {formatDigits(
                              Object.values(i.variant.options ?? {}).join(
                                " / ",
                              ),
                            )}
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
                            disabled={
                              busy ||
                              stockAtRegister(stockVariants[i.variant.id]) ===
                                undefined ||
                              i.quantity >=
                                Math.min(
                                  stockAtRegister(
                                    stockVariants[i.variant.id],
                                  ) ?? 0,
                                  10000,
                                )
                            }
                            aria-label="زيادة الكمية"
                            onClick={() =>
                              cart.quantity(i.variant.id, i.quantity + 1)
                            }
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                        <Button
                          variant="ghost"
                          className="pos-remove-line"
                          aria-label={`حذف ${i.variant.sku} من الفاتورة`}
                          onClick={() => cart.remove(i.variant.id)}
                        >
                          <Trash2 size={15} />
                        </Button>
                        <strong>
                          {fm(
                            decimal(
                              cents(currentPrice(i)) * BigInt(i.quantity),
                            ),
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
                          <option value="FIXED">EGP على السطر</option>
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
                <h3 className="pos-section-heading">
                  <Users size={15} /> بيانات العميل
                </h3>
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
                <h3 className="pos-section-heading">
                  <ReceiptText size={15} /> ملخص الحساب والخصم
                </h3>
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
                        <option value="FIXED">مبلغ ثابت (EGP)</option>
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
                    {quote.data?.data.taxRate ?? store.data?.data.taxRate ?? 0}
                    %)
                  </span>
                  <b>{fm(decimal(summary.tax))}</b>
                </div>
                {quoteError && (
                  <ErrorMessage
                    message={
                      quoteError instanceof ApiError &&
                      quoteError.code === "DISCOUNT_LIMIT"
                        ? "الخصم يتجاوز الحد المسموح لحسابك."
                        : quoteError instanceof Error
                          ? approvalError(quoteError)
                          : "تعذر مراجعة الفاتورة"
                    }
                  />
                )}
                {(quote.data?.data.promotion ||
                  cents(quote.data?.data.customerDiscount) > 0n) && (
                  <div
                    className="notice"
                    role="status"
                    aria-label="تفاصيل الخصومات التلقائية"
                  >
                    <div>
                      {quote.data.data.promotion && (
                        <>
                          <b>{quote.data.data.promotion.name}</b>
                          <p data-testid="promotion-discount">
                            خصم العرض التلقائي:{" "}
                            {fm(quote.data.data.promotionDiscount)}
                          </p>
                        </>
                      )}
                      {cents(quote.data.data.customerDiscount) > 0n && (
                        <p data-testid="customer-discount">
                          خصم العميل الدائم:{" "}
                          {fm(quote.data.data.customerDiscount)}
                        </p>
                      )}
                      {quote.data.data.promotion?.returnRule ===
                        "FULL_BUNDLE" && (
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
                {quoteError instanceof ApiError &&
                  [
                    "DISCOUNT_LIMIT",
                    "DISCOUNT_APPROVAL_INVALID",
                    "DISCOUNT_APPROVAL_CHANGED",
                  ].includes(quoteError.code) &&
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
                {customer &&
                  (quote.data?.data.loyalty?.enabled ||
                    (workspace.active.loyaltyPoints ?? 0) > 0) && (
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
                <h3 className="pos-section-heading">
                  <CreditCard size={15} /> طريقة الدفع
                </h3>
                <Field label="اسم الكاشير">
                  {(id) => (
                    <select
                      id={id}
                      aria-label="اسم الكاشير"
                      value={selectedCashier}
                      disabled={
                        frozen || cashiers.isLoading || !!cashiers.error
                      }
                      onChange={(e) =>
                        field("cashierId", e.target.value || undefined)
                      }
                    >
                      <option value="">اختر اسمك قبل الدفع</option>
                      {(cashiers.data?.data ?? []).map((c: Row) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                {cashiers.error ? (
                  <ErrorMessage message="تعذر تحميل أسماء الكاشيرين. أعد تحميل الصفحة قبل البيع." />
                ) : !cashiers.isLoading && !cashiers.data?.data?.length ? (
                  <ErrorMessage
                    message={
                      'مفيش كاشير متاح. من المستخدمين، اربط مستخدمًا نشطًا بدور "كاشير".'
                    }
                  />
                ) : (
                  <p className="note">
                    الاسم هيتسجل على الفاتورة. آخر اختيار محفوظ على الجهاز، من
                    غير PIN.
                  </p>
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
              </div>
            </div>
            <div className="pos-checkout">
              <div className="grand-total">
                <div>
                  <span>الإجمالي المستحق</span>
                  <small>
                    {cart.items.reduce((n, i) => n + i.quantity, 0)} قطع في
                    الفاتورة
                  </small>
                </div>
                <strong>{fm(decimal(summary.total))}</strong>
              </div>
              <Button
                className="full"
                aria-describedby="pos-checkout-status"
                disabled={frozen || !!checkoutBlockedReason}
                onClick={() => void complete()}
              >
                <Check size={18} />
                {busy ? "جارٍ تسجيل البيع..." : "إتمام البيع"}
              </Button>
              <p
                id="pos-checkout-status"
                className="pos-checkout-status"
                role="status"
                aria-live="polite"
              >
                {checkoutBlockedReason || "جاهز لإتمام البيع."}
              </p>
            </div>
          </section>
        </div>
      </fieldset>
      <Modal
        title="مسح الفاتورة الحالية؟"
        open={clearOpen}
        close={() => setClearOpen(false)}
      >
        <p>
          سيتم حذف كل أصناف الفاتورة وبيانات العميل والدفع من هذه السلة فقط. لا
          يؤثر ذلك على المبيعات المسجلة.
        </p>
        <div className="inline-actions">
          <Button
            variant="outline"
            autoFocus
            onClick={() => setClearOpen(false)}
          >
            رجوع للفاتورة
          </Button>
          <Button
            onClick={() => {
              clear();
              setClearOpen(false);
            }}
          >
            تأكيد مسح الفاتورة
          </Button>
        </div>
      </Modal>
      <Modal
        title="تم البيع بنجاح"
        open={!!receipt}
        close={() => {
          if (commit((w) => ({ ...w, receiptId: null }))) setReceipt(null);
        }}
      >
        {receipt && <ReceiptView sale={receipt} />}
      </Modal>
    </div>
  );
}
