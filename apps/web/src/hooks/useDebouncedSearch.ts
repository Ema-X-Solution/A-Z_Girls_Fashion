import { useEffect, useState } from "react";

export const SEARCH_DEBOUNCE_MS = 300;
export function useDebouncedSearch(value: string) {
  const normalized = value.trim();
  const [debounced, setDebounced] = useState(normalized);
  useEffect(() => {
    const timer = setTimeout(
      () => setDebounced(normalized),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [normalized]);
  return { debounced, searchPending: normalized !== debounced };
}
