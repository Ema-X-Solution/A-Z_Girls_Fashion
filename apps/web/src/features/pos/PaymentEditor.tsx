import { useId } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { cents, decimal } from "./money";
export type PaymentDraft = {
  method: "CASH" | "CARD" | "WALLET" | "BANK";
  amount: string;
  cardBrand: string;
  authorizationCode: string;
  cardLast4: string;
};
export const emptyPayment = (): PaymentDraft => ({
  method: "CASH",
  amount: "",
  cardBrand: "",
  authorizationCode: "",
  cardLast4: "",
});
export function resolvedPayments(rows: PaymentDraft[], due: bigint) {
  return rows.map((row) => ({
    ...row,
    amount:
      row.amount || (rows.length === 1 ? decimal(due > 0n ? due : 0n) : "0"),
  }));
}
export function PaymentEditor({
  value,
  onChange,
  due,
  disabled = false,
}: {
  value: PaymentDraft[];
  onChange: (v: PaymentDraft[]) => void;
  due: bigint;
  disabled?: boolean;
}) {
  const id = useId(),
    update = (index: number, patch: Partial<PaymentDraft>) =>
      onChange(value.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const paid = resolvedPayments(value, due).reduce(
      (s, p) => s + cents(p.amount),
      0n,
    ),
    change = paid > due ? paid - due : 0n;
  return (
    <div className="payment-editor">
      {value.map((row, i) => {
        const suffix = value.length > 1 ? ` ${i + 1}` : "";
        return (
          <fieldset className="payment-row" key={i} disabled={disabled}>
            <legend>دفعة{suffix}</legend>
            <div className="payment-grid">
              <div className="field">
                <label htmlFor={`${id}-method-${i}`}>طريقة الدفع{suffix}</label>
                <select
                  id={`${id}-method-${i}`}
                  value={row.method}
                  onChange={(e) =>
                    update(i, {
                      method: e.target.value as PaymentDraft["method"],
                      cardBrand: "",
                      authorizationCode: "",
                      cardLast4: "",
                    })
                  }
                >
                  <option value="CASH">نقدي</option>
                  <option value="CARD">بطاقة بنكية - تسجيل دفع خارجي</option>
                  <option value="WALLET">محفظة إلكترونية</option>
                  <option value="BANK">تحويل بنكي</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor={`${id}-amount-${i}`}>
                  {value.length === 1
                    ? "المبلغ المستلم (فارغ = المبلغ المستحق)"
                    : `المبلغ ${i + 1}`}
                </label>
                <input
                  id={`${id}-amount-${i}`}
                  type="number"
                  min="0"
                  step="0.01"
                  value={row.amount}
                  onChange={(e) => update(i, { amount: e.target.value })}
                />
              </div>
            </div>
            {row.method === "CARD" && (
              <div className="payment-card-fields">
                <div className="field">
                  <label htmlFor={`${id}-brand-${i}`}>
                    نوع البطاقة{suffix}
                  </label>
                  <select
                    id={`${id}-brand-${i}`}
                    value={row.cardBrand}
                    onChange={(e) => update(i, { cardBrand: e.target.value })}
                  >
                    <option value="">غير محدد</option>
                    <option value="Visa">Visa</option>
                    <option value="Mastercard">Mastercard</option>
                    <option value="Meeza">ميزة</option>
                    <option value="Other">أخرى</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`${id}-auth-${i}`}>رقم التفويض{suffix}</label>
                  <input
                    id={`${id}-auth-${i}`}
                    value={row.authorizationCode}
                    maxLength={64}
                    onChange={(e) =>
                      update(i, { authorizationCode: e.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`${id}-last-${i}`}>
                    آخر 4 أرقام (اختياري){suffix}
                  </label>
                  <input
                    id={`${id}-last-${i}`}
                    inputMode="numeric"
                    maxLength={4}
                    value={row.cardLast4}
                    onChange={(e) =>
                      update(i, {
                        cardLast4: e.target.value.replace(/\D/g, ""),
                      })
                    }
                  />
                </div>
              </div>
            )}
            {value.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                aria-label={`حذف الدفعة ${i + 1}`}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
              >
                <X size={14} />
                حذف الدفعة
              </Button>
            )}
          </fieldset>
        );
      })}
      <Button
        type="button"
        variant="outline"
        disabled={disabled || value.length >= 4}
        onClick={() => onChange([...value, emptyPayment()])}
      >
        <Plus size={15} />
        إضافة طريقة دفع
      </Button>
      {change > 0n && (
        <div className="summary-row">
          <span>الباقي النقدي</span>
          <b>{decimal(change)} EGP</b>
        </div>
      )}
      <p className="note">
        البطاقة والمحفظة تُسجّلان دفعًا تم خارج النظام؛ لا يتم خصم مبلغ من البطاقة
        تلقائيًا.
      </p>
    </div>
  );
}
