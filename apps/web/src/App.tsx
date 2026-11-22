import { validationMessage } from "./components/application/arabicFormValidation";
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
    const onInvalid = (e: Event) => {
      const el = e.target as HTMLInputElement;
      if (el && "validity" in el && !el.validity.valid)
        el.setCustomValidity(validationMessage(el));
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
      {!ready ? (
        <Loading />
      ) : user ? (
        <Shell />
      ) : (
        <LoginPage onError={(error) => notify(readableError(error), true)} />
      )}
    </>
  );
}
