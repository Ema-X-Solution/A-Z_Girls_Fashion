import "./skeleton.css";
import { type CSSProperties, type ReactNode } from "react";

export function Skeleton({
  width = "100%",
  height = 12,
  rounded = false,
}: {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  rounded?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`skeleton${rounded ? " skeleton-rounded" : ""}`}
      style={{ width, height }}
    />
  );
}

function LoadingRegion({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      className="skeleton-region"
      role="status"
      aria-label={label}
      aria-busy="true"
    >
      <span className="skeleton-sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

export function TableSkeleton({
  rows = 8,
  columns = 5,
  label = "جارٍ تحميل القائمة",
}: {
  rows?: number;
  columns?: number;
  label?: string;
}) {
  return (
    <LoadingRegion label={label}>
      <div className="table-skeleton" dir="rtl">
        <div
          className="table-skeleton-row table-skeleton-head"
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(100px, 1fr))`,
          }}
        >
          {Array.from({ length: columns }, (_, i) => (
            <Skeleton key={i} width="55%" />
          ))}
        </div>
        {Array.from({ length: rows }, (_, row) => (
          <div
            className="table-skeleton-row"
            key={row}
            style={{
              gridTemplateColumns: `repeat(${columns}, minmax(100px, 1fr))`,
            }}
          >
            {Array.from({ length: columns }, (_, column) => (
              <div className="skeleton-cell" key={column}>
                {column === 0 && <Skeleton width={38} height={38} rounded />}
                <div className="skeleton-lines">
                  <Skeleton width={column === 0 ? "85%" : "65%"} />
                  {column === 0 && <Skeleton width="55%" height={8} />}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function CardSkeleton({
  count = 3,
  label = "جارٍ تحميل البطاقات",
}: {
  count?: number;
  label?: string;
}) {
  return (
    <LoadingRegion label={label}>
      <div className="card-skeleton-grid" dir="rtl">
        {Array.from({ length: count }, (_, i) => (
          <div className="card-skeleton" key={i}>
            <Skeleton width={40} height={40} rounded />
            <Skeleton width="65%" height={18} />
            <Skeleton width="90%" />
            <Skeleton width="50%" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

export function PickerOptionsSkeleton({
  count = 4,
  label = "جارٍ تحميل الخيارات",
}: {
  count?: number;
  label?: string;
}) {
  return (
    <LoadingRegion label={label}>
      <div className="picker-skeleton" dir="rtl">
        {Array.from({ length: count }, (_, i) => (
          <div className="skeleton-option" key={i}>
            <Skeleton width={20} height={20} />
            <Skeleton width={i % 2 ? "60%" : "80%"} />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
      }
