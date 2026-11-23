import { z } from "zod";
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  MAX_PAGE,
  type PaginatedResult,
} from "@az/shared";

export function pagination(query: {
  readonly page?: unknown;
  readonly pageSize?: unknown;
}) {
  const scalar = z.union([z.string(), z.number()]).optional();
  const current = z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE)
    .default(1)
    .parse(scalar.parse(query.page));
  const size = z.coerce
    .number()
    .int()
    .refine(
      (value) => PAGE_SIZES.some((size) => size === value),
      "Page size must be 25, 50, 100 or 150",
    )
    .default(DEFAULT_PAGE_SIZE)
    .parse(scalar.parse(query.pageSize));
  return {
    page: current,
    pageSize: size,
    skip: (current - 1) * size,
    take: size,
  };
}

export function paginated<T>(
  data: T[],
  total: number,
  current: { page: number; pageSize: number },
): PaginatedResult<T> {
  return {
    data,
    total,
    page: current.page,
    pageSize: current.pageSize,
    hasNext: current.page * current.pageSize < total,
  };
}

// Compatibility boundary during the staged migration. New callers opt in with
// page/pageSize; older limit/offset callers retain their original defaults.
export function usesPagination(query: {
  readonly page?: unknown;
  readonly pageSize?: unknown;
}) {
  return query.page !== undefined || query.pageSize !== undefined;
}

export function listResult<T>(
  query: { readonly page?: unknown; readonly pageSize?: unknown },
  data: T[],
  total: number,
) {
  return usesPagination(query)
    ? paginated(data, total, pagination(query))
    : { data, total };
}
