import { useEffect } from "react";
import "./pagination.css";
import { PAGE_SIZES, type PageSize } from "@az/shared";
import { Button } from "../ui/button";

export function Pagination({
  page,
  pageSize,
  total,
  length,
  onPageChange,
  onPageSizeChange,
  disabled = false,
  unit = "سجل",
}: {
  page: number;
  pageSize: PageSize;
  total: number;
  length: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: PageSize) => void;
  disabled?: boolean;
  unit?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (!disabled && page > pages) onPageChange(pages);
  }, [disabled, page, pages, onPageChange]);
  const start = length ? (page - 1) * pageSize + 1 : 0;
  const end = length ? start + length - 1 : 0;
  return (
    <nav className="list-pagination" aria-label="التنقل بين الصفحات" dir="rtl">
      <span className="pagination-range" aria-live="polite">
        {start}–{end} من {total} {unit}
      </span>
      <label className="pagination-size">
        لكل صفحة
        <select
          aria-label="عدد العناصر في الصفحة"
          value={pageSize}
          disabled={disabled}
          onChange={(event) =>
            onPageSizeChange(Number(event.target.value) as PageSize)
          }
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
      <div className="pagination-navigation">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          السابق
        </Button>
        <span className="pagination-page">
          صفحة {page} من {pages}
        </span>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          التالي
        </Button>
      </div>
    </nav>
  );
}
