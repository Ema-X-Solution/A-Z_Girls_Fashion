import {
  useId,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ShoppingBag, ShieldCheck, X, CircleAlert } from "lucide-react";
import { ApiError } from "../../api";
import { ar, statuses } from "../../i18n";
import { Button } from "../ui/button";
import { readableError } from "../../app/notifications";
import { useAllowed } from "../../hooks/useData";
import { type Row } from "../../app/types";

export function Loading() {
  return (
    <div className="skeletons" aria-label={ar.loading}>
      {[1, 2, 3, 4].map((n) => (
        <div key={n} className="skeleton" />
      ))}
    </div>
  );
}

export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <div className="empty error">
      <CircleAlert />
      <h3>
        {error instanceof ApiError && error.status === 403
          ? ar.forbidden
          : ar.error}
      </h3>
      <p>{readableError(error)}</p>
      <Button variant="outline" onClick={retry}>
        {ar.retry}
      </Button>
    </div>
  );
}

export function Empty() {
  return (
    <div className="empty">
      <ShoppingBag size={32} />
      <h3>{ar.empty}</h3>
      <p>{ar.emptyHint}</p>
    </div>
  );
}

export function Modal({
  title,
  open,
  onClose,
  children,
  error,
  onOutsideClick,
}: {
  error?: string;
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  // When set, clicking outside the modal does not close it; this fires instead.
  onOutsideClick?: () => void;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content
          className="modal"
          dir="rtl"
          onInteractOutside={
            onOutsideClick
              ? (e) => {
                  e.preventDefault();
                  onOutsideClick();
                }
              : undefined
          }
        >
          <div className="modal-head">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" aria-label={ar.cancel}>
                <X size={20} />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            {title} — أكمل الحقول المطلوبة ثم احفظ.
          </Dialog.Description>
          {error && (
            <p className="form-error" role="alert">
              <CircleAlert size={16} />
              {error}
            </p>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const fieldId = useId();
  return (
    <div className="field">
      <label htmlFor={fieldId}>{label}</label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{ id: string }>, {
            id: fieldId,
          })
        : children}
      {hint && <small>{hint}</small>}
    </div>
  );
}

export function Header({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">A&Z • إدارة المتجر</div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="head-actions">{children}</div>
    </div>
  );
}

export function Badge({ value }: { value: string }) {
  return (
    <span className={`badge ${value === "DRAFT" ? "muted" : ""}`}>
      {statuses[value] ?? value}
    </span>
  );
}

export function Table<T extends { id?: string } = Row>({
  rows,
  columns,
  onRowClick,
}: {
  rows: T[];
  columns: { label: string; render: (r: T) => ReactNode }[];
  onRowClick?: (r: T) => void;
}) {
  if (!rows.length) return <Empty />;
  return (
    <div className="table-wrap">
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
            <tr
              key={r.id ?? i}
              onClick={() => onRowClick?.(r)}
              style={onRowClick ? { cursor: "pointer" } : undefined}
            >
              {columns.map((c, j) => (
                <td
                  key={j}
                  onClick={(e) => {
                    if (
                      (e.target as HTMLElement).closest(
                        "button, a, input, select, label",
                      )
                    ) {
                      e.stopPropagation();
                    }
                  }}
                >
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pager({
  offset,
  setOffset,
  length,
  total,
}: {
  offset: number;
  setOffset: (n: number) => void;
  length: number;
  total?: number;
}) {
  return (
    <div className="pager">
      <span>
        {offset + 1} – {offset + length}
        {total !== undefined ? ` / ${total}` : ""}
      </span>
      <Button
        variant="outline"
        disabled={!offset}
        onClick={() => setOffset(Math.max(0, offset - 30))}
      >
        السابق
      </Button>
      <Button
        variant="outline"
        disabled={length < 30}
        onClick={() => setOffset(offset + 30)}
      >
        التالي
      </Button>
    </div>
  );
}

export function Gate({
  permission,
  children,
}: {
  permission: string | string[];
  children: ReactNode;
}) {
  return useAllowed(permission) ? (
    <>{children}</>
  ) : (
    <div className="empty">
      <ShieldCheck />
      <h1>403</h1>
      <p>{ar.forbidden}</p>
    </div>
  );
}
