import { useEffect, useRef, useState } from "react";
import {
  emptyWorkspace,
  readWorkspace,
  saveWorkspace,
  workspaceKey,
  type Workspace,
} from "./workspace";

export function usePosWorkspace(userId: string) {
  const [workspace, setWorkspace] = useState(emptyWorkspace),
    [ready, setReady] = useState(false),
    [storageError, setStorageError] = useState("");
  const current = useRef(workspace),
    writable = useRef(false);
  useEffect(() => {
    let disposed = false,
      release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    if (!navigator.locks) {
      setStorageError(
        "المتصفح لا يدعم حماية جلسة البيع. افتح المشروع في إصدار حديث من Chrome أو Edge.",
      );
      return;
    }
    void navigator.locks
      .request(workspaceKey(userId), { ifAvailable: true }, async (lock) => {
        if (disposed) return;
        if (!lock) {
          setStorageError(
            "نقطة البيع مفتوحة لحسابك في تبويب آخر. أغلقها هناك ثم أعد تحميل هذه الصفحة.",
          );
          return;
        }
        try {
          const loaded = readWorkspace(localStorage, userId);
          // Probe writing before enabling checkout. Never send an unjournaled sale.
          current.current = saveWorkspace(localStorage, userId, loaded);
          setWorkspace(current.current);
          writable.current = true;
          setReady(true);
        } catch {
          setStorageError(
            "تعذر قراءة أو حفظ السلة على هذا المتصفح. احتفظ ببيانات المتصفح وأعد المحاولة بعد توفير مساحة؛ البيع متوقف لحماية العملية المحفوظة.",
          );
        }
        await held;
      })
      .catch(() => {
        if (!disposed)
          setStorageError("تعذر تأمين جلسة البيع. أعد تحميل الصفحة.");
      });
    return () => {
      disposed = true;
      writable.current = false;
      release();
    };
  }, [userId]);
  function commit(change: (previous: Workspace) => Workspace) {
    if (!writable.current) return false;
    try {
      const clean = saveWorkspace(
        localStorage,
        userId,
        change(current.current),
      );
      current.current = clean;
      setWorkspace(clean);
      return true;
    } catch {
      writable.current = false;
      setReady(false);
      setStorageError(
        "تعذر حفظ السلة. لم تُرسل عملية بيع جديدة. وفّر مساحة للمتصفح ثم أعد تحميل الصفحة لاسترجاع آخر حالة محفوظة.",
      );
      return false;
    }
  }
  return { workspace, commit, ready, storageError };
}
