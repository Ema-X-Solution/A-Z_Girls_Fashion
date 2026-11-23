import { PickerOptionsSkeleton } from "./Skeleton";
import "./smart-select.css";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
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
  searchLabel,
  required = true,
  disabled = false,
  placeholder = "ابحث بالاسم أو الكود أو الباركود أو المقاس واللون",
}: {
  searchLabel?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  name: string;
  value: string;
  endpoint: string;
  label: string;
  optionLabel: (option: Row) => string;
  onChange: (variant: Row) => void;
}) {
  const generatedId = useId(),
    inputId = id ?? generatedId,
    listId = `${generatedId}-list`,
    statusId = `${generatedId}-status`;
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const native = useRef<HTMLSelectElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [chosen, setChosen] = useState<Row | null>(null);
  const { debounced, searchPending: pending } = useDebouncedSearch(search);
  const query = useQuery({
    queryKey: [endpoint, debounced, offset, value],
    queryFn: ({ signal }) =>
      api<{ data: Row[]; hasMore: boolean; selected: Row | null }>(
        `${endpoint}${endpoint.includes("?") ? "&" : "?"}q=${encodeURIComponent(debounced)}&offset=${offset}${value ? `&selected=${encodeURIComponent(value)}` : ""}`,
        { signal },
      ),
    enabled: !pending,
  });
  const options = query.data?.data ?? [];
  const selected =
    options.find((option) => option.id === value) ??
    (query.data?.selected?.id === value ? query.data.selected : null) ??
    (chosen?.id === value ? chosen : null);
  const loading = pending || query.isFetching;
  const expanded = open && !disabled;
  const active = !loading && !query.error ? options[activeIndex] : undefined;
  function close() {
    setOpen(false);
    setSearch("");
    setOffset(0);
    setActiveIndex(-1);
  }
  function choose(option: Row) {
    setChosen(option.id ? option : null);
    setInvalid(false);
    onChange(option);
    close();
    input.current?.focus();
  }
  function changePage(next: number) {
    setOffset(next);
    setActiveIndex(-1);
    input.current?.focus();
  }
  useEffect(() => {
    native.current?.setCustomValidity("");
    if (value) setInvalid(false);
  }, [value]);
  useEffect(() => {
    if (disabled) close();
  }, [disabled]);
  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        root.current?.contains(document.activeElement)
      ) {
        event.preventDefault();
        event.stopPropagation();
        close();
        input.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", escape, true);
    };
  }, [expanded]);
  useLayoutEffect(() => {
    if (!expanded || !popup.current || !root.current) return;
    const panel = popup.current;
    // The top layer avoids clipping inside scrollable forms and modal dialogs,
    // while keeping the popup in the form's DOM and focus scope.
    const position = () => {
      const rect = root.current!.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const flip = below < 260 && above > below;
      panel.style.width = `${Math.min(rect.width, window.innerWidth - 24)}px`;
      panel.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - rect.width - 12))}px`;
      panel.style.maxHeight = `${Math.max(120, flip ? above : below)}px`;
      panel.style.top = flip ? "auto" : `${rect.bottom + 6}px`;
      panel.style.bottom = flip
        ? `${window.innerHeight - rect.top + 6}px`
        : "auto";
    };
    position();
    panel.showPopover();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    const observer = new ResizeObserver(position);
    observer.observe(root.current);
    return () => {
      panel.hidePopover();
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [expanded]);
  useEffect(() => {
    if (expanded && active)
      document
        .getElementById(`${listId}-${active.id}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [expanded, active, listId]);
  return (
    <div
      ref={root}
      className={`smart-select${expanded ? " is-open" : ""}${disabled ? " is-disabled" : ""}`}
      dir="rtl"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          close();
      }}
    >
      <div className="smart-select-control">
        <input
          ref={input}
          id={inputId}
          className="smart-select-input"
          type="text"
          role="combobox"
          disabled={disabled}
          placeholder={expanded ? placeholder : `اختر ${fieldLabel}...`}
          autoComplete="off"
          value={
            expanded
              ? search
              : selected
                ? label(selected)
                : value
                  ? "جاري تحميل الاختيار..."
                  : ""
          }
          aria-label={searchLabel ?? fieldLabel}
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={expanded ? statusId : undefined}
          aria-activedescendant={
            expanded && active ? `${listId}-${active.id}` : undefined
          }
          onFocus={(event) => event.currentTarget.select()}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            setOpen(true);
            setSearch(event.target.value);
            setOffset(0);
            setActiveIndex(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              if (!loading && !query.error) {
                const direction = event.key === "ArrowDown" ? 1 : -1;
                setActiveIndex((index) =>
                  options.length
                    ? index < 0
                      ? direction === 1
                        ? 0
                        : options.length - 1
                      : (index + direction + options.length) % options.length
                    : -1,
                );
              }
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (expanded && active) choose(active);
              else setOpen(true);
            } else if (
              expanded &&
              (event.key === "PageDown" || event.key === "PageUp")
            ) {
              event.preventDefault();
              if (!loading && !query.error) {
                if (event.key === "PageDown" && query.data?.hasMore)
                  changePage(offset + 50);
                if (event.key === "PageUp" && offset > 0)
                  changePage(offset - 50);
              }
            } else if (event.key === "Escape" && expanded) {
              event.preventDefault();
              event.stopPropagation();
              close();
            } else if (event.key === "Tab") close();
          }}
        />
        {!required && value && !disabled && (
          <button
            className="smart-select-icon-button"
            type="button"
            aria-label={`مسح ${fieldLabel}`}
            onClick={() => choose({ id: "", name: "" })}
          >
            <X size={15} aria-hidden="true" />
          </button>
        )}
        <button
          className="smart-select-icon-button smart-select-toggle"
          type="button"
          disabled={disabled}
          aria-label={
            expanded ? `إغلاق قائمة ${fieldLabel}` : `فتح قائمة ${fieldLabel}`
          }
          tabIndex={-1}
          onClick={() => {
            if (expanded) close();
            else setOpen(true);
            input.current?.focus();
          }}
        >
          <ChevronDown size={17} aria-hidden="true" />
        </button>
      </div>
      {/* Preserve native form values and required validation without a second visible control. */}
      <select
        ref={native}
        className="smart-select-native"
        name={name}
        required={required}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        onInvalid={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setInvalid(true);
          setOpen(true);
          input.current?.focus();
        }}
        onChange={(event) => {
          const option = options.find((row) => row.id === event.target.value);
          if (option) choose(option);
          else if (!event.target.value && !required)
            choose({ id: "", name: "" });
        }}
      >
        <option value="">اختر...</option>
        {value && !options.some((option) => option.id === value) && (
          <option value={value}>
            {selected ? label(selected) : "الاختيار الحالي"}
          </option>
        )}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {label(option)}
          </option>
        ))}
      </select>
      {invalid && !value && (
        <small className="smart-select-validation" role="alert">
          يرجى اختيار {fieldLabel}.
        </small>
      )}
      {expanded && (
        <div
          ref={popup}
          className="smart-select-popup"
          popover="manual"
          dir="rtl"
        >
          <div
            className="smart-select-status"
            id={statusId}
            role="status"
            aria-live="polite"
          >
            <span>
              {loading
                ? "جاري البحث..."
                : query.error
                  ? "تعذر تحميل الاختيارات."
                  : options.length
                    ? `${options.length} نتيجة • صفحة ${offset / 50 + 1}`
                    : "لا توجد نتائج مطابقة. جرّب كلمة أخرى."}
            </span>
            {selected && (
              <span className="smart-select-current">
                المختار: {label(selected)}
              </span>
            )}
          </div>
          {loading && (
            <div className="smart-select-loading" aria-hidden="true">
              <PickerOptionsSkeleton count={2} />
            </div>
          )}
          {query.error && !loading && (
            <div className="smart-select-empty">
              <Button
                type="button"
                variant="outline"
                onClick={() => void query.refetch()}
              >
                إعادة المحاولة
              </Button>
            </div>
          )}
          <div
            id={listId}
            role="listbox"
            aria-label={fieldLabel}
            aria-busy={loading}
            className="smart-select-options"
          >
            {!loading &&
              !query.error &&
              options.map((option, index) => (
                <div
                  id={`${listId}-${option.id}`}
                  key={option.id}
                  role="option"
                  aria-selected={option.id === value}
                  className={`smart-select-option${activeIndex === index ? " is-active" : ""}`}
                  onPointerMove={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                >
                  <span>{label(option)}</span>
                  {option.id === value && (
                    <Check size={16} aria-hidden="true" />
                  )}
                </div>
              ))}
          </div>
          <div className="smart-select-pages">
            <Button
              type="button"
              variant="outline"
              disabled={loading || offset === 0}
              onClick={() => changePage(offset - 50)}
            >
              السابق
            </Button>
            <small>صفحة {offset / 50 + 1}</small>
            <Button
              type="button"
              variant="outline"
              disabled={loading || !!query.error || !query.data?.hasMore}
              onClick={() => changePage(offset + 50)}
            >
              التالي
            </Button>
          </div>
        </div>
      )}
    </div>
  );
        }
