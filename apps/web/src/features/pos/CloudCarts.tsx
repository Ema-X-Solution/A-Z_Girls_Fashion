import { useState, useEffect, useRef } from "react";
import { api, post } from "../../api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cartDraftSchema } from "@az/shared";
import { Modal, ErrorMessage } from "../shared/Controls";
import { Grid, Pagination, when, type Row } from "../management/Tools";
import { type CartDraft } from "./workspace";
export function CloudCarts({
  draft,
  locationId,
  disabled,
  onLoad,
  onClear,
  onBusyChange,
  onReadyChange,
}: {
  draft: CartDraft;
  locationId?: string;
  disabled: boolean;
  onLoad: (draft: CartDraft) => boolean;
  onClear: () => void;
  onBusyChange: (busy: boolean) => void;
  onReadyChange: (ready: boolean) => void;
}) {
  const [open, setOpen] = useState(false),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reserve, setReserve] = useState(false),
    [retry, setRetry] = useState(0),
    client = useQueryClient();
  const query = useQuery({
    queryKey: ["cloud-carts", offset],
    queryFn: ({ signal }) => api(`/shared-carts?offset=${offset}`, { signal }),
    enabled: open,
    refetchInterval: open ? 5000 : false,
  });
  const { sharedCart, ...body } = draft,
    encoded = JSON.stringify(body),
    lastSync = useRef("");
  const lastStamp = useRef(0);
  const frozen = disabled || busy;
  useEffect(() => {
    if (!sharedCart) {
      lastSync.current = "";
      onReadyChange(true);
      return;
    }
    if (disabled) return;
    const key =
      sharedCart.id + sharedCart.revision + sharedCart.token + encoded + retry;
    if (lastSync.current === key) return;
    let alive = true;
    onReadyChange(false);
    const timer = setTimeout(() => {
      onBusyChange(true);
      lastStamp.current = Math.max(Date.now(), lastStamp.current + 1);
      void api(`/shared-carts/${sharedCart.id}/sync`, {
        method: "POST",
        body: JSON.stringify({
          binding: sharedCart,
          stamp: lastStamp.current,
          draft: JSON.parse(encoded),
        }),
      })
        .then(() => {
          if (alive) {
            lastSync.current = key;
            setError("");
            onBusyChange(false);
            onReadyChange(true);
          }
        })
        .catch((e) => {
          if (alive) {
            setError(e.message + "؛ صحّح السلة أو أعد المزامنة قبل البيع.");
            onBusyChange(false);
            onReadyChange(false);
          }
        });
    }, 500);
    return () => {
      alive = false;
      clearTimeout(timer);
      onBusyChange(false);
    };
  }, [
    encoded,
    sharedCart?.id,
    sharedCart?.revision,
    sharedCart?.token,
    retry,
    disabled,
  ]);
  useEffect(() => {
    if (!sharedCart || disabled) return;
    const heartbeat = setInterval(() => setRetry((n) => n + 1), 5 * 60000);
    return () => clearInterval(heartbeat);
  }, [sharedCart?.id, disabled]);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      await fn();
      await client.invalidateQueries({ queryKey: ["cloud-carts"] });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "تعذر الاتصال بالسلال المشتركة",
      );
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  async function suspend() {
    await run(async () => {
      if (sharedCart)
        await post(
          `/shared-carts/${sharedCart.id}/release`,
          { binding: sharedCart, draft: body },
          crypto.randomUUID(),
        );
      else {
        if (!locationId) throw new Error("افتح ورديتك لتحديد مخزن السلة");
        await post(
          "/shared-carts",
          {
            title:
              draft.notes.slice(0, 80) ||
              `سلة ${new Date().toLocaleString("ar-EG")}`,
            locationId,
            draft: body,
            reserve,
          },
          crypto.randomUUID(),
        );
      }
      onClear();
    });
  }
  return (
    <div className="cloud-carts">
      <div className="inline-actions">
        <button
          type="button"
          className="btn btn-outline"
          disabled={frozen || !draft.items.length}
          onClick={() => void suspend()}
        >
          {sharedCart ? "حفظ وتحرير السلة للخادم" : "تعليق ومزامنة للخادم"}
        </button>
        <button
          type="button"
          className="btn btn-outline"
          disabled={frozen}
          onClick={() => setOpen(true)}
        >
          السلال المشتركة
        </button>
      </div>
      {!sharedCart && (
        <label className="management-note">
          <input
            type="checkbox"
            checked={reserve}
            disabled={frozen}
            onChange={(e) => setReserve(e.target.checked)}
          />{" "}
          حجز الكميات 30 دقيقة عند التعليق
        </label>
      )}
      {sharedCart && (
        <p className="management-note">
          سلة مرتبطة بالخادم: التعديلات تتزامن تلقائيًا، ومهلة الاستخدام 30 دقيقة
          منذ آخر مزامنة. حرّرها للخادم لاستكمالها من جهاز آخر.
        </p>
      )}
      <ErrorMessage message={error} />
      {error && sharedCart && (
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => setRetry((n) => n + 1)}
        >
          إعادة المزامنة
        </button>
      )}
      {error && sharedCart && (
        <div className="inline-actions">
          <button
            type="button"
            className="btn btn-outline"
            disabled={frozen}
            onClick={() =>
              void run(async () => {
                const result = await post(
                  `/shared-carts/${sharedCart.id}/claim`,
                  {},
                  crypto.randomUUID(),
                );
                onLoad({
                  ...body,
                  discountApprovalId: undefined,
                  sharedCart: result.data.binding,
                });
                setRetry((n) => n + 1);
              })
            }
          >
            إعادة حجز السلة بعد انتهاء المهلة
          </button>
          <button
            type="button"
            className="btn btn-outline"
            disabled={frozen}
            onClick={() => {
              if (
                window.confirm(
                  "إغلاق النسخة المحلية؟ تبقى نسخة الخادم؛ لا تنشئ بيعًا جديدًا قبل التحقق من أي محاولة معلقة.",
                )
              )
                onClear();
            }}
          >
            إغلاق النسخة المحلية
          </button>
        </div>
      )}
      <Modal
        title="السلال المشتركة بين الأجهزة"
        open={open}
        close={() => setOpen(false)}
      >
        <ErrorMessage message={error} />
        <p className="management-note">
          استئناف السلة يحتاج سلة محلية فارغة وجهازًا تابعًا لنفس المخزن. السلة
          المستخدمة لا تُفتح من جهاز ثانٍ حتى تحريرها أو انتهاء مهلة استخدامها.
        </p>
        <ErrorMessage message={query.error?.message ?? ""} />
        <Grid
          rows={query.data?.data ?? []}
          columns={[
            { label: "السلة", render: (r) => r.title },
            { label: "آخر مزامنة", render: (r) => when(r.updatedAt) },
            {
              label: "الحالة",
              render: (r) =>
                r.status === "CLAIMED" && new Date(r.leaseUntil) > new Date()
                  ? "قيد الاستخدام"
                  : "متاحة",
            },
            {
              label: "حجز مخزون",
              render: (r) =>
                r.reservations.some(
                  (x: Row) => new Date(x.expiresAt) > new Date(),
                )
                  ? "فعال"
                  : "بدون حجز",
            },
            {
              label: "الإجراءات",
              render: (r) => (
                <div className="inline-actions">
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={frozen || draft.items.length > 0 || !locationId}
                    onClick={() =>
                      void run(async () => {
                        if (r.locationId !== locationId)
                          throw new Error("اختر وردية في مخزن السلة");
                        const result = await post(
                          `/shared-carts/${r.id}/claim`,
                          {},
                          crypto.randomUUID(),
                        );
                        const loaded = cartDraftSchema.parse({
                          ...result.data.draft,
                          discountApprovalId: undefined,
                          sharedCart: result.data.binding,
                        });
                        if (!onLoad(loaded)) {
                          await api(`/shared-carts/${r.id}/release`, {
                            method: "POST",
                            body: JSON.stringify({
                              binding: result.data.binding,
                              draft: result.data.draft,
                            }),
                          });
                          throw new Error("تعذر حفظ السلة محليًا");
                        }
                        setOpen(false);
                      })
                    }
                  >
                    استئناف
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={frozen}
                    onClick={() => {
                      if (window.confirm("إلغاء السلة المشتركة وإلغاء حجزها؟"))
                        void run(async () => {
                          await post(
                            `/shared-carts/${r.id}/cancel`,
                            {},
                            crypto.randomUUID(),
                          );
                        });
                    }}
                  >
                    إلغاء
                  </button>
                </div>
              ),
            },
          ]}
        />
        <Pagination
          offset={offset}
          onChange={setOffset}
          total={query.data?.total ?? 0}
        />
      </Modal>
    </div>
  );
}
