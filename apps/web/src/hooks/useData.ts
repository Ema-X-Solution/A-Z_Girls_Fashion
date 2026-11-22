import { useQuery } from "@tanstack/react-query";
import { api, useSession } from "../api";

export function useData(path: string, enabled = true, searchPending = false) {
  const query = useQuery({
    queryKey: [path],
    queryFn: ({ signal }) => api(path, { signal }),
    enabled: enabled && !searchPending,
  });
  return searchPending ? { ...query, isLoading: true } : query;
}

export function useAllowed(p: string | string[]) {
  return useSession((s) =>
    (Array.isArray(p) ? p : [p]).some((key) =>
      s.user?.permissions.includes(key),
    ),
  );
}
