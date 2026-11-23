import { TableSkeleton } from "../../components/application/Skeleton";
import { readableError } from "../../app/notifications";
import { ApiError } from "../../api";
import { displayLocale } from "../../i18n";
import {
  useState,
  useId,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, useSession } from "../../api";
export type Row = Record<string, any>;
export const allowed = (key: string) =>
  useSession.getState().user?.permissions.includes(key) ?? false;
export function useRows(path: string, enabled = true) {
  return useQuery({
    queryKey: [path],
    queryFn: ({ signal }) => api(path, { signal }),
    enabled,
  });
}
export function useTask() {
  const client = useQueryClient(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(fn: () => Promise<any>, done?: (r: any) => void) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await fn();
      done?.(result);
      await client.invalidateQueries();
      return result;
    } catch (e) {
      setError(
        e instanceof ApiError
          ? readableError(e)
          : e instanceof Error
            ? e.message
            : "تعذر تنفيذ العملية",
      );
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, clearError: () => setError("") };
}
export const save = (path: string, body: unknown) =>
  post(path, body, crypto.randomUUID());
export const patch = (path: string, body: unknown) =>
  api(path, { method: "PATCH", body: JSON.stringify(body) });
export function Grid({
  rows,
  columns,
}: {
  rows: Row[];
  columns: { label: string; render: (r: Row) => ReactNode }[];
}) {
  return (
    <div className="management-table">
      <table>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i}>
              {columns.map((c, j) => (
                <td key={j}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="empty">لا توجد نتائج</p>}
    </div>
  );
}
export function PageState({
  query,
}: {
  query: { isLoading: boolean; error: unknown };
}) {
  return query.isLoading ? (
    <TableSkeleton />
  ) : query.error ? (
    <p role="alert">
      {query.error instanceof Error ? query.error.message : "تعذر التحميل"}
    </p>
  ) : null;
}
export function FormField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const fieldId = useId();
  return (
    <div className="management-field">
      <label htmlFor={fieldId}>{label}</label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id?: string }>, {
            id: fieldId,
          })
        : children}
    </div>
  );
}
export const fmt = (v: unknown) => (v == null ? "—" : String(v));
export const when = (v: unknown) =>
  v ? new Date(String(v)).toLocaleString(displayLocale) : "—";
