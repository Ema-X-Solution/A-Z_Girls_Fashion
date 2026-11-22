import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X, CircleAlert, Check } from "lucide-react";
import { ApiError } from "../api";
import { ar } from "../i18n";

export let notify: (message: string, error?: boolean) => void = () => {};

export function readableError(error: unknown) {
  if (!(error instanceof ApiError)) return ar.error;
  const messages: Record<string, string> = {
    RETURN_PERIOD: "انتهت مدة الإرجاع المسموح بها لهذه الفاتورة.",
    RETURN_QUANTITY: "كمية المرتجع أكبر من الكمية المتاحة للإرجاع.",
    INSUFFICIENT_STOCK: "الكمية المطلوبة أكبر من المخزون المتاح في مكان البيع.",
    SHIFT_EXISTS: "توجد وردية مفتوحة بالفعل لهذا الجهاز أو الكاشير.",
    SHIFT_CLOSED: "افتح وردية قبل تنفيذ هذه العملية.",
    REGISTER_INACTIVE: "الجهاز أو الفرع غير نشط.",
    EXPORT_LIMIT:
      "عدد النتائج أكبر من حد التصدير 10,000 صف. ضيّق الفترة أو البحث.",
    DATE_RANGE: "اختر فترة صحيحة لا تتجاوز 366 يومًا.",
    INVALID_DISCOUNT: "الخصم أكبر من المسموح. راجع قيمة الخصم ونوعه.",
    VALIDATION: "راجع الحقول المطلوبة والقيم المدخلة.",
    FORBIDDEN: "ليس لديك صلاحية تنفيذ هذه العملية.",
    NOT_FOUND: "السجل المطلوب غير موجود.",
    P2002: "هذه القيمة مسجلة بالفعل. استخدم قيمة أخرى.",
    ROLE_NAME_EXISTS: "اسم الدور مسجل بالفعل. اختر اسمًا آخر.",
    CUSTOMER_PHONE_EXISTS: "رقم الهاتف مسجل بالفعل لعميل آخر.",
    APPROVER_LIMIT:
      "الخصم المطلوب أكبر من حد موافقتك. يلزم مراجع بحد خصم أعلى.",
  };
  const labels: Record<string, string> = {
    invoicePrefix:
      "بادئة رقم الفاتورة (1 إلى 12 حرفًا إنجليزيًا أو رقمًا أو - أو _)",
    taxRate: "نسبة الضريبة (0 إلى 100)",
    returnDays: "فترة الاسترجاع (عدد صحيح من 0 إلى 365)",
    receiptFooter: "رسالة الإيصال (1000 حرف بحد أقصى)",
    returnPolicy: "سياسة الاستبدال والاسترجاع (3 إلى 5000 حرف)",
    spendPerPoint:
      "مبلغ الشراء لكل نقطة (1 على الأقل، بمنزلتين عشريتين كحد أقصى)",
    pointValue: "قيمة النقطة (0.01 إلى 100)",
    expiryDays: "صلاحية النقاط (عدد صحيح من 1 إلى 3650)",
    maxRedeemPercent: "أقصى نسبة استبدال (عدد صحيح من 1 إلى 90)",
    minimumRedeemPoints: "أقل عدد نقاط (عدد صحيح من 1 إلى 1000000)",
    password: "كلمة المرور",
    email: "البريد الإلكتروني",
    name: "الاسم",
    roleIds: "الدور",
    discountLimit: "حد الخصم",
    openingCash: "النقد الافتتاحي",
    countedCash: "النقد الفعلي",
    registerId: "جهاز الكاشير",
    amount: "المبلغ",
    quantity: "الكمية",
    discount: "الخصم",
    phone: "رقم الهاتف",
    notes: "الملاحظات",
  };
  const details = error.fields
    ? Object.entries(error.fields)
        .flatMap(([field, messages]) =>
          messages.map((message) => {
            if (field === "password" && message.includes("Too small"))
              return "كلمة المرور يجب أن تكون 8 أحرف على الأقل";
            if (message.includes("Invalid email"))
              return "البريد الإلكتروني غير صحيح";
            if (/[\u0600-\u06ff]/.test(message)) return message;
            return `تحقق من قيمة ${labels[field] ?? "الحقل"}`;
          }),
        )
        .join(" • ")
    : "";
  const message =
    messages[error.code] ??
    (/[\u0600-\u06ff]/.test(error.message)
      ? error.message
      : "تعذر تنفيذ العملية. راجع البيانات وحاول مرة أخرى.");
  return details ? `${ar.error}: ${details}` : `${ar.error}: ${message}`;
}

export function Toasts() {
  const [toast, setToast] = useState<{
    message: string;
    error?: boolean;
  } | null>(null);
  useEffect(() => {
    notify = (message, error) => setToast({ message, error });
    return () => {
      notify = () => {};
    };
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  return toast ? (
    <div className={`toast ${toast.error ? "toast-error" : ""}`} role="status">
      {toast.error ? <CircleAlert size={20} /> : <Check size={20} />}{" "}
      {toast.message}
      <button aria-label={ar.cancel} onClick={() => setToast(null)}>
        <X size={16} />
      </button>
    </div>
  ) : null;
}

export function useAction() {
  const client = useQueryClient(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return {
    busy,
    error,
    clearError: () => setError(""),
    run: async (
      fn: () => Promise<unknown>,
      done?: () => void,
      inlineError = false,
    ) => {
      if (busy) return;
      setBusy(true);
      setError("");
      try {
        const result = await fn();
        await client.invalidateQueries();
        notify(typeof result === "string" && result ? result : ar.success);
        done?.();
      } catch (e) {
        const message = readableError(e);
        setError(message);
        if (!inlineError) notify(message, true);
      } finally {
        setBusy(false);
      }
    },
  };
}
