import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X, CircleAlert, Check } from "lucide-react";
import { ApiError } from "../api";
import { ar } from "../i18n";

export let notify: (message: string, error?: boolean) => void = () => {};

export function readableError(error: unknown) {
  if (!(error instanceof ApiError)) return ar.error;
  const labels: Record<string, string> = {
    password: "كلمة المرور",
    email: "البريد الإلكتروني",
    name: "الاسم",
    roleIds: "الدور",
    discountLimit: "حد الخصم",
  };
  const details = error.fields
    ? Object.entries(error.fields)
        .flatMap(([field, messages]) =>
          messages.map((message) => {
            if (field === "password" && message.includes("Too small"))
              return "كلمة المرور يجب أن تكون ٨ أحرف على الأقل";
            if (message.includes("Invalid email"))
              return "البريد الإلكتروني غير صحيح";
            return `${labels[field] ?? field}: ${message}`;
          }),
        )
        .join(" • ")
    : "";
  return details ? `${ar.error}: ${details}` : `${ar.error}: ${error.message}`;
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
    [busy, setBusy] = useState(false);
  return {
    busy,
    run: async (fn: () => Promise<unknown>, done?: () => void) => {
      if (busy) return;
      setBusy(true);
      try {
        await fn();
        await client.invalidateQueries();
        notify(ar.success);
        done?.();
      } catch (e) {
        notify(
          readableError(e),
          true,
        );
      } finally {
        setBusy(false);
      }
    },
  };
}
