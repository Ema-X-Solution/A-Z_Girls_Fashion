export const PAGE_SIZES = [25, 50, 100, 150] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const MAX_PAGE = 1_000_000;
export const DEFAULT_PAGE_SIZE: PageSize = 25;
export type PaginatedResult<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
};
