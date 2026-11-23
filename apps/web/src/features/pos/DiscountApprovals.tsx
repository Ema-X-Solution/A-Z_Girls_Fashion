import { Pagination } from "../../components/application/Pagination";
import { TableSkeleton } from "../../components/application/Skeleton";
import { usePagination } from "../../hooks/usePagination";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, useSession } from "../../api";
import { Button } from "../../components/ui/button";
import { Header, ErrorMessage, Field, Modal } from "../shared/Controls";
import { displayLocale, formatDigits, formatMoney } from "../../i18n";
import { approvalError } from "./approval-messages";
const labels: Record<string, string> = {
  PENDING: "قيد المراجعة",
  APPROVED: "موافق عليه",
  REJECTED: "مرفوض",
  CONSUMED: "تم البيع بالموافقة",
};
export function DiscountApprovals() {
  const user = useSession((s) => s.user)!,
    client = useQueryClient(),
    [selected, setSelected] = useState<any>(null),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const paging = usePagination();
  const query = useQuery({
    queryKey: ["discount-approvals",paging.page,paging.pageSize],
    queryFn: ({signal}) => api(`/discount-approvals?${paging.query}`,{signal}),
    refetchInterval: 5000,
  });
  const allowed = user.permissions.includes("sales.discount_approve");
  async function decide(decision: string) {
    setBusy(true);
    setError("");
    try {
      await post(`/discount-approvals/${selected.id}/decision`, {
        decision,
        note,
      });
      setSelected(null);
      await client.invalidateQueries();
    } catch (e) {
      setError(approvalError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Header
        title="موافقات الخصومات"
        subtitle={
          allowed
            ? `راجع الخصم والسبب قبل الاعتماد. حد موافقتك ${user.discountLimit}%.`
            : "طلباتك للخصومات الاستثنائية ونتيجة مراجعة المدير."
        }
      />
      <ErrorMessage
        message={
          !selected ? error || (query.error instanceof Error ? query.error.message : "") : ""
        }
      />
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              {[
                "الكاشير",
                "سبب الطلب",
                "قبل الخصم",
                "الخصم",
                "المستحق",
                "الحالة",
                "المراجع",
                "الإجراءات",
              ].map((t) => (
                <th key={t}>{t}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {query.data?.data.map((r: any) => (
              <tr key={r.id}>
                <td>{r.requesterName}</td>
                <td style={{ whiteSpace: "normal", maxWidth: 240 }}>
                  {r.reason}
                </td>
                <td>{formatMoney(r.subtotal)}</td>
                <td>{formatMoney(r.discount)}</td>
                <td>{formatMoney(r.total)}</td>
                <td>
                  {r.status !== "CONSUMED" && new Date(r.expiresAt) < new Date()
                    ? "انتهت الصلاحية"
                    : labels[r.status]}
                </td>
                <td>{r.approverName || "—"}</td>
                <td>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setError("");
                      setSelected(r);
                      setNote("");
                    }}
                  >
                    مراجعة الطلب
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!query.data?.data.length && (
          <p className="empty">
            {query.isLoading ? "جارٍ تحميل الطلبات..." : "لا توجد طلبات خصم."}
          </p>
        )}
        {query.isLoading && <TableSkeleton />}
        <Pagination page={paging.page} pageSize={paging.pageSize} onPageChange={paging.setPage} onPageSizeChange={paging.setPageSize} total={query.data?.total ?? 0} length={query.data?.data.length ?? 0} disabled={query.isFetching} />
      </section>
      <Modal
        title="مراجعة الخصم"
        open={!!selected}
        error={error}
        close={() => {
          if (!busy) setSelected(null);
        }}
      >
        {selected && (
          <>
            <p>الكاشير: {selected.requesterName}</p>
            <p>سبب الطلب: {selected.reason}</p>
            {selected.input.displayPromotion && (
              <p>
                العرض التلقائي: {selected.input.displayPromotion.name} — خصم{" "}
                {formatMoney(selected.input.automaticDiscount)}. الخصم اليدوي
                المطلوب اعتماده: {formatMoney(selected.input.manualDiscount)}.
              </p>
            )}
            <p>
              الخصم: {formatMoney(selected.discount)} من{" "}
              {formatMoney(selected.subtotal)} — المستحق:{" "}
              {formatMoney(selected.total)}
            </p>
            <p>
              صالح حتى: {new Date(selected.expiresAt).toLocaleString(displayLocale)}
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الصنف</th>
                    <th>الكمية</th>
                    <th>سعر القطعة</th>
                    <th>خصم السطر</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.input.items.map((i: any) => {
                    const display = selected.input.displayItems?.find(
                      (d: any) => d.variantId === i.variantId,
                    );
                    return (
                      <tr key={i.variantId}>
                        <td>
                          {display?.name || "صنف"}
                          <br />
                          <small>
                            {display?.sku} —{" "}
                            {formatDigits(Object.values(display?.options ?? {}).join(" / "))}
                          </small>
                        </td>
                        <td>{i.quantity}</td>
                        <td>{formatMoney(display?.unitPrice ?? 0)}</td>
                        <td>
                          {i.discount}{" "}
                          {i.discountType === "PERCENT" ? "%" : "EGP"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {selected.decisionNote && (
              <p>قرار المراجع: {selected.decisionNote}</p>
            )}
            {allowed &&
              selected.requesterId !== user.id &&
              selected.status === "PENDING" &&
              new Date(selected.expiresAt) > new Date() && (
                <>
                  <Field label="ملاحظة القرار">
                    {(id) => (
                      <input
                        id={id}
                        value={note}
                        maxLength={1000}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    )}
                  </Field>
                  <div className="head-actions">
                    <Button
                      disabled={busy || note.trim().length < 3}
                      onClick={() => void decide("APPROVED")}
                    >
                      الموافقة على الخصم
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy || note.trim().length < 3}
                      onClick={() => void decide("REJECTED")}
                    >
                      رفض الطلب
                    </Button>
                  </div>
                </>
              )}
          </>
        )}
      </Modal>
    </>
  );
}
