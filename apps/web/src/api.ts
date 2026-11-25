import { create } from "zustand";
export type User = {
  id: string;
  name: string;
  email: string;
  roles: string[];
  permissions: string[];
  csrf: string;
  discountLimit: string;
};
export const useSession = create<{
  user: User | null;
  setUser: (u: User | null) => void;
}>((set) => ({ user: null, setUser: (user) => set({ user }) }));
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string[]>,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
  key?: string,
): Promise<T> {
  const csrf = useSession.getState().user?.csrf;
  const response = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
      ...options.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) {
    if (response.status === 401) useSession.getState().setUser(null);
    throw new ApiError(
      response.status,
      body.error?.code ?? "ERROR",
      body.error?.message ?? "Request failed",
      body.error?.fields?.fieldErrors,
    );
  }
  return body;
}
const pendingKeys = new Map<string, string>();
export const post = async (path: string, body: unknown, key?: string) => {
  const encoded = JSON.stringify(body),
    fingerprint = `${path}:${encoded}`;
  if (key) {
    key = pendingKeys.get(fingerprint) ?? key;
    pendingKeys.set(fingerprint, key);
  }
  try {
    const result = await api(path, { method: "POST", body: encoded }, key);
    pendingKeys.delete(fingerprint);
    return result;
  } catch (e) {
    if (e instanceof ApiError && e.status < 500)
      pendingKeys.delete(fingerprint);
    throw e;
  }
};
export const patch = (path: string, body: unknown) =>
  api(path, { method: "PATCH", body: JSON.stringify(body) });
export const del = (path: string) => api(path, { method: "DELETE" });
export const useCart = create<{
  items: { variant: any; quantity: number }[];
  add: (v: any) => void;
  quantity: (id: string, q: number) => void;
  clear: () => void;
  load: (items: { variant: any; quantity: number }[]) => void;
}>((set) => ({
  items: [],
  add: (v) =>
    set((s) => ({
      items: s.items.some((i) => i.variant.id === v.id)
        ? s.items.map((i) =>
            i.variant.id === v.id ? { ...i, quantity: i.quantity + 1 } : i,
          )
        : [...s.items, { variant: v, quantity: 1 }],
    })),
  quantity: (id, q) =>
    set((s) => ({
      items: s.items
        .map((i) => (i.variant.id === id ? { ...i, quantity: q } : i))
        .filter((i) => i.quantity > 0),
    })),
  clear: () => set({ items: [] }),
  load: (items) => set({ items }),
}));
