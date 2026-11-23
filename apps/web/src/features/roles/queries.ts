import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import type { Role } from "./types";

export function useRoles(query="") {
  return useQuery({
    queryKey: ["/roles",query],
    queryFn: ({ signal }) => api<{ data: Role[];total:number }>(`/roles${query?`?${query}`:""}`, { signal }),
  });
}

export function usePermissions() {
  return useQuery({
    queryKey: ["/permissions"],
    queryFn: ({ signal }) => api<{ data: string[] }>("/permissions", { signal }),
  });
}
