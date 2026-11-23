import { Pagination } from "../../components/application/Pagination";
import { usePagination } from "../../hooks/usePagination";
import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Search } from "lucide-react";
import {
  customerPhoneKey,
  customerPhoneSchema,
  customerPhoneSearch,
} from "@az/shared";
import { api, post } from "../../api";
import { Button } from "../../components/ui/button";
import { ErrorMessage, Field } from "../shared/Controls";
import { useDebouncedSearch } from "../../hooks/useDebouncedSearch";
type Customer = { id: string; name: string; phone: string };
export function CustomerPicker({
  value,
  search,
  name,
  disabled,
  onSearch,
  onName,
  onSelect,
  onBusyChange,
}: {
  value: string;
  search: string;
  name: string;
  disabled: boolean;
  onSearch: (text: string) => void;
  onName: (text: string) => void;
  onSelect: (customer: Customer | null) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const client = useQueryClient(),
    listId = useId(),
    input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0),
    [creating, setCreating] = useState(false),
    [error, setError] = useState("");
  const { debounced, searchPending } = useDebouncedSearch(search);
  const paging=usePagination(search.trim(),true,"local");
  const searchAllowed =
    search.trim().length >= 2 || !!customerPhoneSearch(search);
  useEffect(() => {
    setActive(0);
  }, [search]);
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  const selected = useQuery({
    queryKey: ["pos-selected-customer", value],
    queryFn: ({ signal }) => api(`/customers/${value}`, { signal }),
    enabled: !!value,
  });
  useEffect(() => {
    if (value && selected.data?.data && !search)
      onSearch(selected.data.data.phone);
  }, [value, selected.data, search, onSearch]);
  const results = useQuery({
    queryKey: ["pos-customer-search", debounced, paging.page,paging.pageSize],
    queryFn: ({ signal }) =>
      api(
        `/customers?q=${encodeURIComponent(debounced)}&${paging.query}`,
        { signal },
      ),
    enabled: open && !searchPending && searchAllowed,
  });
  const settled = !searchPending && !results.isFetching && results.isSuccess;
  const rows: Customer[] = settled ? (results.data?.data ?? []) : [];
  const valid = customerPhoneSchema.safeParse(search);
  const exact =
    valid.success &&
    rows.some(
      (c) => customerPhoneKey(c.phone) === customerPhoneKey(valid.data),
    );
  const canCreate = settled && valid.success && !exact && !value;
  function select(customer: Customer) {
    client.setQueryData(["pos-selected-customer", customer.id], {
      data: customer,
    });
    onSearch(customer.phone);
    onName("");
    onSelect(customer);
    setOpen(false);
    setError("");
  }
  async function create() {
    if (!canCreate || disabled || creating) return;
    setCreating(true);
    onBusyChange(true);
    setError("");
    try {
      const result = await post("/customers/resolve", {
        phone: valid.data,
        name: name.trim(),
      });
      select(result.data);
      await client.invalidateQueries({ queryKey: ["pos-customer-search"] });
      await client.invalidateQueries({
        predicate: (q) =>
          typeof q.queryKey[0] === "string" &&
          q.queryKey[0].startsWith("/customers"),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر إضافة العميل");
    } finally {
      setCreating(false);
      onBusyChange(false);
    }
  }
  return (
    <div
      className="customer-picker"
      dir="rtl"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <Field label="رقم العميل أو الاسم">
        {(id) => (
          <div className="customer-picker-search">
            <Search size={16} />
            <input
              ref={input}
              id={id}
              role="combobox"
              aria-expanded={open && !disabled}
              aria-autocomplete="list"
              aria-controls={listId}
              aria-activedescendant={
                open && rows[active] ? `${listId}-${active}` : undefined
              }
              type="text"
              dir="ltr"
              autoComplete="off"
              maxLength={100}
              placeholder="اكتب رقم التليفون أو ابحث بالاسم"
              value={search}
              disabled={disabled || creating}
              onFocus={() => setOpen(true)}
              onChange={(e) => {
                onSelect(null);
                onSearch(e.target.value);
                onName("");
                setOpen(true);
                setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setOpen(true);
                  setActive((i) =>
                    Math.min(i + 1, Math.max(0, rows.length - 1)),
                  );
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((i) => Math.max(0, i - 1));
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setOpen(false);
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (open && rows[active]) select(rows[active]!);
                  else if (canCreate) void create();
                }
              }}
            />
          </div>
        )}
      </Field>
      <p className="customer-picker-help">
        رقم العميل مطلوب لكل فاتورة، حتى عند الدفع نقدًا. الاسم اختياري.
      </p>
      {value && selected.data?.data && (
        <div className="customer-picker-selected">
          <Check size={16} />
          <div>
            <bdi dir="ltr" className="customer-phone">
              {selected.data.data.phone}
            </bdi>
            {selected.data.data.name && <span>{selected.data.data.name}</span>}
          </div>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled || creating}
            onClick={() => {
              onSelect(null);
              onSearch("");
              onName("");
              setOpen(true);
              input.current?.focus();
            }}
          >
            تغيير العميل
          </Button>
        </div>
      )}
      {selected.error && (
        <ErrorMessage message="تعذر تحميل رقم العميل المختار. أعد البحث واختياره." />
      )}
      {open && !disabled && (
        <div className="customer-picker-results">
          {!searchAllowed ? (
            <p className="note">
              اكتب أي جزء من الرقم أو حرفين من الاسم للبحث.
            </p>
          ) : !settled && !results.error ? (
            <p className="note" role="status">
              جارٍ البحث…
            </p>
          ) : null}
          {results.error && (
            <>
              <ErrorMessage message="تعذر البحث في العملاء." />
              <Button
                type="button"
                variant="outline"
                onClick={() => void results.refetch()}
              >
                إعادة البحث
              </Button>
            </>
          )}
          <div id={listId} role="listbox" aria-label="نتائج بحث العملاء">
            {rows.map((customer, index) => (
              <button
                type="button"
                id={`${listId}-${index}`}
                key={customer.id}
                role="option"
                aria-selected={customer.id === value}
                data-active={index === active}
                disabled={creating}
                className="customer-picker-option"
                onMouseEnter={() => setActive(index)}
                onClick={() => select(customer)}
              >
                <bdi dir="ltr" className="customer-phone">
                  {customer.phone}
                </bdi>
                <span>{customer.name || "بدون اسم"}</span>
              </button>
            ))}
          </div>
          {settled && rows.length === 0 && (
            <p className="note">الرقم أو الاسم غير مسجل.</p>
          )}
          {settled && <Pagination page={paging.page} pageSize={paging.pageSize} onPageChange={p=>{paging.setPage(p);setActive(0)}} onPageSizeChange={s=>{paging.setPageSize(s);setActive(0)}} total={results.data?.total??0} length={rows.length} disabled={creating || results.isFetching}/>}

          {canCreate && (
            <div className="customer-picker-create">
              <Field label="اسم العميل (اختياري)">
                {(id) => (
                  <input
                    id={id}
                    value={name}
                    maxLength={200}
                    disabled={creating}
                    placeholder="يمكن ترك الاسم فارغًا"
                    onChange={(e) => onName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void create();
                      }
                    }}
                  />
                )}
              </Field>
              <Button
                type="button"
                disabled={creating}
                onClick={() => void create()}
              >
                {creating ? "جارٍ حفظ العميل…" : "إضافة العميل واختياره"}
              </Button>
            </div>
          )}
          {settled &&
            !valid.success &&
            search.trim() &&
            !/[\p{L}]/u.test(search) && (
              <p className="note">أكمل رقم التليفون لإضافة عميل جديد.</p>
            )}
        </div>
      )}
      <ErrorMessage message={error} />
    </div>
  );
              }
