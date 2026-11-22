import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import type { Role } from "./types";

export function useRoles() {
  return useQuery({
    queryKey: ["/roles"],
    queryFn: ({ signal }) => api<{ data: Role[] }>("/roles", { signal }),
  });
}

export function usePermissions() {
  return useQuery({
    queryKey: ["/permissions"],
    queryFn: ({ signal }) => api<{ data: string[] }>("/permissions", { signal }),
  });
}

