import { describe, expect, it } from "vitest";
import { pagination, paginated } from "../apps/api/src/utils/pagination";

describe("unified pagination contract", () => {
  it("defaults to 25 and accepts only the four chosen sizes", () => {
    expect(pagination({})).toEqual({
      page: 1,
      pageSize: 25,
      skip: 0,
      take: 25,
    });
    for (const size of [25, 50, 100, 150]) {
      expect(pagination({ page: "3", pageSize: String(size) })).toEqual({
        page: 3,
        pageSize: size,
        skip: size * 2,
        take: size,
      });
    }
    for (const size of [0, 30, 151, -1, 25.5, "bad", [25], [25, 50], {}])
      expect(() => pagination({ pageSize: size })).toThrow();
    for (const page of [0, -1, 1.5, "bad", 1000001, {}])
      expect(() => pagination({ page })).toThrow();
  });
  it("uses totals rather than page length for hasNext including exact boundaries", () => {
    expect(paginated([1], 25, { page: 1, pageSize: 25 })).toEqual({
      data: [1],
      total: 25,
      page: 1,
      pageSize: 25,
      hasNext: false,
    });
    expect(paginated([], 0, { page: 1, pageSize: 25 }).hasNext).toBe(false);
    expect(paginated([1], 26, { page: 1, pageSize: 25 }).hasNext).toBe(true);
  });
});
