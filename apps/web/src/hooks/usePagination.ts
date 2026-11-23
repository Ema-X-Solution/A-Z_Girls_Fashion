import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  MAX_PAGE,
  type PageSize,
} from "@az/shared";

// URL mode is for list pages; local mode isolates nested pickers/dialogs.
// Never write URL state at mount: doing so can race with a login redirect.
export function usePagination(
  filterKey = "",
  enabled = true,
  storage: "url" | "local" = "url",
) {
  const [urlParams, setUrlParams] = useSearchParams();
  const [localParams, setLocalParams] = useState(new URLSearchParams());
  const params = storage === "local" ? localParams : urlParams;
  const previousFilter = useRef(filterKey);
  const setParams = useCallback(
    (update: (previous: URLSearchParams) => URLSearchParams) => {
      if (storage === "local") setLocalParams(update);
      else setUrlParams(update, { replace: true });
    },
    [storage, setUrlParams],
  );
  const rawPage = Number(params.get("page") ?? 1),
    rawSize = Number(params.get("pageSize") ?? DEFAULT_PAGE_SIZE);
  const pageSize: PageSize =
    PAGE_SIZES.find((size) => size === rawSize) ?? DEFAULT_PAGE_SIZE;
  const page =
    previousFilter.current === filterKey &&
    (params.get("paginationFilter") === null ||
      params.get("paginationFilter") === filterKey) &&
    Number.isInteger(rawPage) &&
    rawPage > 0 &&
    rawPage <= MAX_PAGE
      ? rawPage
      : 1;
  useEffect(() => {
    if (!enabled || previousFilter.current === filterKey) return;
    previousFilter.current = filterKey;
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("page", "1");
      next.set("paginationFilter", filterKey);
      return next;
    });
  }, [enabled, filterKey, setParams]);
  const update = useCallback(
    (nextPage: number, size = pageSize) =>
      setParams((previous) => {
        const next = new URLSearchParams(previous);
        next.set("page", String(Math.min(MAX_PAGE, Math.max(1, nextPage))));
        next.set("pageSize", String(size));
        next.set("paginationFilter", filterKey);
        return next;
      }),
    [pageSize, filterKey, setParams],
  );
  return {
    page,
    pageSize,
    query: `page=${page}&pageSize=${pageSize}`,
    setPage: useCallback((value: number) => update(value), [update]),
    setPageSize: useCallback((value: PageSize) => update(1, value), [update]),
  };
}
