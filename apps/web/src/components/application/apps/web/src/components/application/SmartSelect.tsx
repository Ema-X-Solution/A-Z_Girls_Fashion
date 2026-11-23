import "./smart-select.css";
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { type Row } from "../../app/types";
import { useDebouncedSearch } from "../../hooks/useDebouncedSearch";
import { Button } from "../../components/ui/button";

export function SmartSelect({
  id,
  name,
  value,
  onChange,
  endpoint,
  label: fieldLabel,
  optionLabel: label,
}: {
  id?: string;
  name: string;
  value: string;
  endpoint: string;
  label: string;
  optionLabel: (option: Row) => string;
  onChange: (variant: Row) => void;
}) {
  const searchId = useId(),
    statusId = useId();
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [chosen, setChosen] = useState<Row | null>(null);
  const { debounced, searchPending: pending } = useDebouncedSearch(search);
  const query = useQuery({
    queryKey: [endpoint, debounced, offset, value],
    queryFn: ({ signal }) =>
      api<{ data: Row[]; hasMore: boolean; selected: Row | null }>(
        `${endpoint}?q=${encodeURIComponent(debounced)}&offset=${offset}${value ? `&selected=${encodeURIComponent(value)}` : ""}`,
        { signal },
      ),
    enabled: !pending,
  });
  const options = query.data?.data ?? [];
  const selected =
    options.find((option) => option.id === value) ??
    query.data?.selected ??
    (chosen?.id === value ? chosen : null);
  const loading = pending || query.isFetching;
  return (
    <div className="smart-select" dir="rtl">
      <label className="smart-select-label" htmlFor={searchId}>
        بحث عن {fieldLabel}
      </label>
      <input
        id={searchId}
        type="search"
        placeholder="ابحث بالاسم أو الكود أو الباركود أو المقاس واللون"
        autoComplete="off"
        value={search}
        aria-describedby={statusId}
        onChange={(event) => {
          setSearch(event.target.value);
          setOffset(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.preventDefault();
          if (event.key === "Escape") {
            setSearch("");
            setOffset(0);
          }
        }}
      />
      <small id={statusId} role="status">
        {loading
          ? "جاري البحث..."
          : query.error
            ? "تعذر تحميل الأصناف."
            : options.length
              ? `${options.length} نتيجة • صفحة ${offset / 50 + 1}`
              : "لا توجد أصناف مطابقة. جرّب كلمة أخرى."}
      </small>
      {query.error && (
        <Button
          type="button"
          variant="outline"
          onClick={() => void query.refetch()}
        >
          إعادة المحاولة
        </Button>
      )}
      {selected && search && <small>الصنف المختار: {label(selected)}</small>}
      <select
        key={`${debounced}:${offset}`}
        id={id}
        name={name}
        required
        aria-label="اختيار الصنف"
        value={value}
        size={
          search && options.length ? Math.min(options.length + 1, 5) : undefined
        }
        onChange={(event) => {
          const variant = options.find(
            (option) => option.id === event.target.value,
          );
          if (variant) {
            setChosen(variant);
            onChange(variant);
            setSearch("");
            setOffset(0);
          }
        }}
      >
        <option value="">اختر...</option>
        {value && !options.some((option) => option.id === value) && (
          <option value={value} hidden>
            {selected ? label(selected) : "الصنف المختار"}
          </option>
        )}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {label(option)}
          </option>
        ))}
      </select>
      <div className="smart-select-pages">
        <Button
          type="button"
          variant="outline"
          disabled={loading || offset === 0}
          onClick={() => setOffset(offset - 50)}
        >
          السابق
        </Button>
        <small>50 صنف بحد أقصى في الصفحة</small>
        <Button
          type="button"
          variant="outline"
          disabled={loading || !query.data?.hasMore}
          onClick={() => setOffset(offset + 50)}
        >
          التالي
        </Button>
      </div>
    </div>
  );
        }
