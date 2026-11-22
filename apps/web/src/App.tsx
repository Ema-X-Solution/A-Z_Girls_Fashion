import { useEffect, useState } from "react";
import { api, useSession } from "./api";
import { LoginPage } from "./features/auth/LoginPage";
import { notify, readableError, Toasts } from "./app/notifications";
import { Loading } from "./components/application/Primitives";
import { Shell } from "./app/Shell";

export default function App() {
  const [ready, setReady] = useState(false),
    user = useSession((s) => s.user),
    setUser = useSession((s) => s.setUser);
  useEffect(() => {
    api("/auth/me")
      .then((r) => setUser(r.data))
      .catch(() => {})
      .finally(() => setReady(true));
  }, [setUser]);
  useEffect(() => {
    const arabicMessage = (
      el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    ) => {
      const v = el.validity;
      if (v.valueMissing)
        return el.tagName === "SELECT" ? "اختر من القائمة." : "أكمل هذا الحقل.";
      if (v.tooShort) return "النص أقصر من الحد الأدنى المطلوب.";
      if (v.rangeUnderflow) return "القيمة لا يمكن أن تكون سالبة.";
      if (v.rangeOverflow) return "القيمة أكبر من الحد المسموح.";
      return "راجع قيمة الحقل.";
    };
    const onInvalid = (e: Event) => {
      const el = e.target as HTMLInputElement;
      if (el && "validity" in el && !el.validity.valid)
        el.setCustomValidity(arabicMessage(el));
    };
    const clearMessage = (e: Event) => {
      const el = e.target as HTMLInputElement;
      if (el && "setCustomValidity" in el) el.setCustomValidity("");
    };
    document.addEventListener("invalid", onInvalid, true);
    document.addEventListener("input", clearMessage, true);
    document.addEventListener("change", clearMessage, true);
    return () => {
      document.removeEventListener("invalid", onInvalid, true);
      document.removeEventListener("input", clearMessage, true);
      document.removeEventListener("change", clearMessage, true);
    };
  }, []);
  return (
    <>
      <Toasts />
      {!ready ? <Loading /> : user ? <Shell /> : (
        <LoginPage onError={(error) => notify(readableError(error), true)} />
      )}
    </>
  );
}
