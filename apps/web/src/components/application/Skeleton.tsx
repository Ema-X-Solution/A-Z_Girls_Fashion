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

const LOADER_PARTICLES = [15, 65, 110, 160, 205, 250, 295, 340].map(
  (deg, i) => {
    const rad = (deg * Math.PI) / 180;
    const dist = 150 + (i % 3) * 26;
    return {
      x: Math.cos(rad) * dist,
      y: Math.sin(rad) * dist,
      delay: (i * 0.09).toFixed(2),
    };
  },
);

export function AppLoader({
  label = "جارٍ تحميل النظام",
  theme = "dark",
}: {
  label?: string;
  /** "dark" is the default; "light" uses the light-theme CSS variable overrides. */
  theme?: "dark" | "light";
}) {
  return (
    <div
      className={theme === "light" ? "app-loader app-loader--light" : "app-loader"}
      role="status"
      aria-label={label}
      aria-busy="true"
    >
      <span className="skeleton-sr-only">{label}</span>
      <div className="app-loader-stage" aria-hidden="true">
        <svg className="app-loader-orbit" viewBox="0 0 100 100">
          <circle className="app-loader-orbit-ring" cx="50" cy="50" r="48" />
          <circle className="app-loader-orbit-tail" cx="50" cy="50" r="48" />
          <circle className="app-loader-orbit-arc" cx="50" cy="50" r="48" />
        </svg>
        <span className="app-loader-particles">
          {LOADER_PARTICLES.map((p, i) => (
            <span
              className="app-loader-particle"
              key={i}
              style={
                {
                  "--px": `${p.x.toFixed(1)}px`,
                  "--py": `${p.y.toFixed(1)}px`,
                  "--pd": `-${p.delay}s`,
                } as React.CSSProperties
              }
            />
          ))}
        </span>
        <span className="app-loader-logo">
          <img src="/brand/az-logo.jpg" alt="" />
          <span className="app-loader-sheen" />
        </span>
      </div>
    </div>
  );
}

export function DashboardSkeleton({
  label = "جارٍ تحميل لوحة المتابعة",
}: {
  label?: string;
}) {
  const bars = [42, 68, 55, 80, 62, 74, 50];
  return (
    <LoadingRegion label={label}>
      <div dir="rtl">
        <div className="stat-grid">
          {Array.from({ length: 4 }, (_, i) => (
            <section
              className={`stat-card skeleton-stat${
                i === 0 ? " skeleton-stat-featured" : ""
              }`}
              key={i}
            >
              <Skeleton width="50%" height={10} />
              <Skeleton width="65%" height={24} />
              <Skeleton width="35%" height={8} />
            </section>
          ))}
        </div>
        <div className="dashboard-grid">
          <section className="panel skeleton-panel">
            <Skeleton width="28%" height={12} />
            <div className="skeleton-chart">
              {bars.map((height, i) => (
                <span className="skeleton-chart-bar" key={i}>
                  <Skeleton width="100%" height={`${height}%`} />
                </span>
              ))}
            </div>
          </section>
          <section className="panel skeleton-panel">
            <Skeleton width="40%" height={12} />
            <div className="skeleton-summary">
              {Array.from({ length: 5 }, (_, i) => (
                <div className="skeleton-summary-row" key={i}>
                  <Skeleton width="45%" />
                  <Skeleton width="20%" />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </LoadingRegion>
  );
}

export function FormSkeleton({
  fields = 6,
  withSubmit = true,
  label = "جارٍ تحميل النموذج",
}: {
  fields?: number;
  withSubmit?: boolean;
  label?: string;
}) {
  return (
    <LoadingRegion label={label}>
      <div dir="rtl">
        <div className="form-grid">
          {Array.from({ length: fields }, (_, i) => (
            <div className="skeleton-field" key={i}>
              <Skeleton width="35%" height={10} />
              <Skeleton width="100%" height={34} />
            </div>
          ))}
        </div>
        {withSubmit && (
          <div className="skeleton-form-submit">
            <Skeleton width={130} height={36} />
          </div>
        )}
      </div>
    </LoadingRegion>
  );
}

export function ReceiptSkeleton({
  label = "جارٍ تحميل الفاتورة",
}: {
  label?: string;
}) {
  return (
    <LoadingRegion label={label}>
      <div className="receipt-skeleton" dir="rtl">
        <Skeleton width={64} height={64} rounded />
        <Skeleton width="45%" height={16} />
        <Skeleton width="60%" />
        <div className="receipt-skeleton-lines">
          <Skeleton width="80%" />
          <Skeleton width="70%" />
        </div>
        <div className="receipt-skeleton-rows">
          {Array.from({ length: 4 }, (_, i) => (
            <div className="receipt-skeleton-row" key={i}>
              <Skeleton width="40%" />
              <Skeleton width="15%" />
              <Skeleton width="15%" />
              <Skeleton width="18%" />
            </div>
          ))}
        </div>
        <div className="receipt-skeleton-lines">
          {Array.from({ length: 3 }, (_, i) => (
            <div className="receipt-skeleton-row" key={i}>
              <Skeleton width="35%" />
              <Skeleton width="20%" />
            </div>
          ))}
        </div>
        <Skeleton width="55%" height={40} />
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
