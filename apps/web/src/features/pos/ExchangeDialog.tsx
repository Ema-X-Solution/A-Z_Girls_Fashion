import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../../api";
import { Button } from "../../components/ui/button";
import { formatDigits, formatMoney as fm } from "../../i18n";
import { Modal, Field, ErrorMessage } from "../shared/Controls";
import { ReceiptView } from "../receipts/ReceiptView";
import { PaymentEditor, emptyPayment, resolvedPayments } from "./PaymentEditor";
import { cents, decimal } from "./money";
import { useDebouncedSearch } from "../../hooks/useDebouncedSearch";
type Row = Record<string, any>;
export function ExchangeDialog({
  sale,
  close,
}: {
  sale: Row;
  close: () => void;
}) {
  const client = useQueryClient(),
    [selected, setSelected] = useState<
      Record<string, { quantity: number; sellable: boolean }>
    >({}),
    [replacement, setReplacement] = useState<
      { variant?: Row; quantity: number }[]
    >([{ quantity: 1 }]),
    [cashierId, setCashierId] = useState(""),
    [q, setQ] = useState(""),
    [reason, setReason] = useState(""),
    [reasonType, setReasonType] = useState("CHANGE_MIND"),
    [method, setMethod] = useState("CASH"),
    [payments, setPayments] = useState([emptyPayment()]),
    [discount, setDiscount] = useState("0"),
    [discountType, setDiscountType] = useState("FIXED"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState<Row | null>(null),
    [key, setKey] = useState(() => crypto.randomUUID());
  const { debounced: debouncedQ, searchPending } = useDebouncedSearch(q);
  const cashiers = useQuery({
    queryKey: ["pos-cashiers"],
    queryFn: () => api("/sales/cashiers"),
  });
  const shift = useQuery({
      queryKey: ["exchange-shift"],
      queryFn: () => api("/shifts/current"),
    }),
    catalog = useQuery({
      queryKey: ["exchange-catalog", debouncedQ],
      queryFn: ({ signal }) =>
        api(`/products?q=${encodeURIComponent(debouncedQ)}&limit=100`, {
          signal,
        }),
      enabled: !searchPending,
    });
  const variants: Row[] =
    catalog.data?.data.flatMap((p: Row) =>
      p.variants
        .filter((v: Row) => v.active && p.status === "ACTIVE")
        .map((v: Row) => ({ ...v, name: p.nameAr })),
    ) ?? [];
  const body = {
    returned: {
      shiftId: shift.data?.data?.id,
      reason: reason.trim().length >= 3 ? reason : "طلب استبدال",
      reasonType,
      method,
      items: Object.entries(selected)
        .filter(([, v]) => v.quantity > 0)
        .map(([saleItemId, v]) => ({ saleItemId, ...v })),
    },
    replacement: {
      cashierId: cashierId || undefined,
      shiftId: shift.data?.data?.id,
      items: replacement
        .filter((r) => r.variant)
        .map((r) => ({ variantId: r.variant!.id, quantity: r.quantity })),
      discount: discount || "0",
      discountType,
      payments: [],
      ...(sale.customerId ? { customerId: sale.customerId } : {}),
    },
  };
  const quote = useQuery({
    queryKey: ["exchange-quote", sale.id, body],
    queryFn: ({ signal }) =>
      api(`/sales/${sale.id}/exchanges/quote`, {
        method: "POST",
        body: JSON.stringify(body),
        signal,
      }),
    enabled:
      !!shift.data?.data &&
      body.returned.items.length > 0 &&
      body.replacement.items.length > 0 &&
      !done,
    retry: false,
  });
  const raw = String(quote.data?.data.difference ?? "0"),
    difference = raw.startsWith("-") ? -cents(raw.slice(1)) : cents(raw);
  useEffect(
    () => setKey(crypto.randomUUID()),
    [
      selected,
      replacement,
      reason,
      reasonType,
      method,
      payments,
      discount,
      discountType,
      cashierId,
    ],
  );
  async function submit() {
    if (busy) return;
    if (!cashierId) {
      setError("اختر اسم الكاشير للفاتورة البديلة.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await post(
        `/sales/${sale.id}/exchanges/net`,
        {
          ...body,
          returned: { ...body.returned, reason: reason.trim() },
          replacement: {
            ...body.replacement,
            payments:
              difference > 0n ? resolvedPayments(payments, difference) : [],
          },
        },
        key,
      );
      setDone(response.data);
      await client.invalidateQueries();
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر تنفيذ الاستبدال");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        done
          ? `تم الاستبدال #${done.number}`
          : `استبدال من ${sale.receiptNumber ?? sale.number}`
      }
      open
      close={close}
    >
      {done ? (
        <ReceiptView sale={done.replacement} exchange={done} />
      ) : (
        <>
          <p className="note">
            تُسجّل المرتجعات والبدائل معًا، ويتم تحصيل أو رد فرق السعر فقط.
          </p>
          {!shift.isLoading && !shift.data?.data && (
            <p className="notice">افتح وردية الدرج لإتمام الاستبدال.</p>
          )}
          <Field label="اسم الكاشير للفاتورة البديلة">
            {(id) => (
              <select
                id={id}
                value={cashierId}
                disabled={busy}
                onChange={(e) => setCashierId(e.target.value)}
              >
                <option value="">اختر اسم الكاشير</option>
                {(cashiers.data?.data ?? []).map((c: Row) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {!cashiers.isLoading && !cashiers.data?.data?.length && (
            <ErrorMessage
              message={
                'مفيش كاشير متاح. اربط مستخدمًا نشطًا بدور اسمه "كاشير" بالضبط.'
              }
            />
          )}
          <h3>الأصناف المرتجعة</h3>
          {sale.items
            .filter((i: Row) => i.returned < i.quantity)
            .map((item: Row) => (
              <div className="exchange-original" key={item.id}>
                <Field
                  label={`${item.name} • ${formatDigits(Object.values(item.options ?? {}).join(" / "))} • المتاح ${item.quantity - item.returned}`}
                >
                  {(id) => (
                    <input
                      id={id}
                      aria-label={`كمية استبدال ${item.sku || item.barcode}`}
                      type="number"
                      min="0"
                      max={item.quantity - item.returned}
                      step="1"
                      value={selected[item.id]?.quantity ?? 0}
                      disabled={busy}
                      onChange={(e) =>
                        setSelected((old) => ({
                          ...old,
                          [item.id]: {
                            quantity: Number(e.target.value),
                            sellable: old[item.id]?.sellable ?? true,
                          },
                        }))
                      }
                    />
                  )}
                </Field>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={selected[item.id]?.sellable ?? true}
                    onChange={(e) =>
                      setSelected((old) => ({
                        ...old,
                        [item.id]: {
                          quantity: old[item.id]?.quantity ?? 0,
                          sellable: e.target.checked,
                        },
                      }))
                    }
                  />
                  صالح للبيع
                </label>
              </div>
            ))}
          <div className="form-grid">
            <Field label="سبب الإرجاع">
              {(id) => (
                <select
                  id={id}
                  value={reasonType}
                  onChange={(e) => setReasonType(e.target.value)}
                >
                  <option value="CHANGE_MIND">
                    تغيير مقاس / لون / رغبة العميل
                  </option>
                  <option value="MANUFACTURING_DEFECT">عيب صناعة</option>
                </select>
              )}
            </Field>
            <Field label="سبب الاستبدال بالتفصيل">
              {(id) => (
                <textarea
                  id={id}
                  required
                  minLength={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              )}
            </Field>
          </div>
          <h3>الأصناف البديلة</h3>
          <Field label="بحث الأصناف البديلة">
            {(id) => (
              <input
                id={id}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="اسم المنتج أو كوده"
              />
            )}
          </Field>
          {catalog.error && <ErrorMessage message="تعذر تحميل المنتجات" />}
          {replacement.map((row, index) => {
            const options = row.variant
              ? [
                  ...variants.filter((v) => v.id !== row.variant!.id),
                  row.variant,
                ]
              : variants;
            return (
              <div className="exchange-replacement" key={index}>
                <Field label={`الصنف البديل ${index + 1}`}>
                  {(id) => (
                    <select
                      id={id}
                      value={row.variant?.id ?? ""}
                      disabled={searchPending || catalog.isFetching}
                      onChange={(e) =>
                        setReplacement((old) =>
                          old.map((r, j) =>
                            j === index
                              ? {
                                  ...r,
                                  variant: options.find(
                                    (v) => v.id === e.target.value,
                                  ),
                                }
                              : r,
                          ),
                        )
                      }
                    >
                      <option value="">اختر الصنف والمقاس...</option>
                      {options.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name} •{" "}
                          {formatDigits(
                            Object.values(v.options ?? {}).join(" / "),
                          )}{" "}
                          • {v.sku} • {fm(v.price)}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label={`كمية البديل ${index + 1}`}>
                  {(id) => (
                    <input
                      id={id}
                      type="number"
                      min="1"
                      max="10000"
                      step="1"
                      value={row.quantity}
                      onChange={(e) =>
                        setReplacement((old) =>
                          old.map((r, j) =>
                            j === index
                              ? { ...r, quantity: Number(e.target.value) }
                              : r,
                          ),
                        )
                      }
                    />
                  )}
                </Field>
                {replacement.length > 1 && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      setReplacement((old) => old.filter((_, j) => j !== index))
                    }
                  >
                    حذف البديل
                  </Button>
                )}
              </div>
            );
          })}
          <Button
            variant="outline"
            onClick={() => setReplacement((old) => [...old, { quantity: 1 }])}
          >
            إضافة صنف بديل
          </Button>
          <div className="form-grid">
            <Field label="خصم الفاتورة البديلة">
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
            <Field label="نوع خصم الفاتورة البديلة">
              {(id) => (
                <select
                  id={id}
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value)}
                >
                  <option value="FIXED">جنيه</option>
                  <option value="PERCENT">نسبة %</option>
                </select>
              )}
            </Field>
          </div>
          {quote.data && (
            <div className="exchange-totals">
              <div className="summary-row">
                <span>قيمة المرتجع</span>
                <b>{fm(quote.data.data.returnTotal)}</b>
              </div>
              <div className="summary-row">
                <span>قيمة البديل</span>
                <b>{fm(quote.data.data.replacementTotal)}</b>
              </div>
              <div className="grand-total">
                <span>
                  {difference > 0n
                    ? "المطلوب تحصيله"
                    : difference < 0n
                      ? "المطلوب رده للعميل"
                      : "استبدال بنفس القيمة"}
                </span>
                <strong>
                  {fm(decimal(difference < 0n ? -difference : difference))}
                </strong>
              </div>
            </div>
          )}
          {difference > 0n && (
            <PaymentEditor
              value={payments}
              onChange={setPayments}
              due={difference}
              disabled={busy}
            />
          )}{" "}
          {difference < 0n && (
            <Field label="طريقة استرداد فرق السعر">
              {(id) => (
                <select
                  id={id}
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  <option value="CASH">نقدي من الوردية</option>
                  <option value="CARD">رد خارجي للبطاقة</option>
                  <option value="WALLET">محفظة</option>
                  <option value="BANK">تحويل بنكي</option>
                </select>
              )}
            </Field>
          )}
          <ErrorMessage
            message={
              error || (quote.error instanceof Error ? quote.error.message : "")
            }
          />
          {reason.trim().length < 3 && (
            <p className="note" role="status">
              اكتب سبب الاستبدال بالتفصيل (3 أحرف على الأقل) لتفعيل زر الاعتماد.
            </p>
          )}
          <Button
            className="full"
            disabled={
              busy ||
              !quote.data ||
              quote.isFetching ||
              !!quote.error ||
              reason.trim().length < 3 ||
              !shift.data?.data
            }
            onClick={() => void submit()}
          >
            {busy ? "جارٍ التسجيل..." : "اعتماد الاستبدال"}
          </Button>
        </>
      )}
    </Modal>
  );
}
