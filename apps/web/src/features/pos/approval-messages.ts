import { ApiError } from "../../api";
const messages: Record<string, string> = {
  DISCOUNT_APPROVAL_INVALID:
    "موافقة الخصم لم تُعتمد بعد، أو انتهت صلاحيتها أو استُخدمت. راجع نتيجة الطلب قبل البيع.",
  DISCOUNT_APPROVAL_CHANGED:
    "السلة أو الأسعار اتغيّرت. أزل الطلب واطلب موافقة جديدة.",
  DISCOUNT_APPROVAL_USED:
    "موافقة الخصم استُخدمت في فاتورة أخرى. اطلب موافقة جديدة.",
  APPROVER_LIMIT: "الخصم المطلوب أكبر من حد موافقتك. يلزم مراجع بحد خصم أعلى.",
  APPROVER_UNAVAILABLE: "حساب المراجع أو مقدم الطلب لم يعد متاحًا.",
  SELF_APPROVAL: "لا يمكنك اعتماد طلب الخصم الخاص بك. يلزم مراجع آخر.",
  APPROVAL_CLOSED:
    "الطلب انتهت صلاحيته أو تم اتخاذ قرار فيه بالفعل. حدّث القائمة.",
  APPROVAL_NOT_REQUIRED: "الخصم داخل حد حسابك ولا يحتاج موافقة استثنائية.",
  TOO_MANY_APPROVALS:
    "لديك طلبات معلّقة كثيرة. راجع الطلبات الحالية قبل إنشاء طلب آخر.",
};
export function approvalError(error: unknown) {
  return error instanceof ApiError
    ? (messages[error.code] ?? error.message)
    : "تعذر الاتصال. أعد المحاولة بعد التحقق من الاتصال.";
}
