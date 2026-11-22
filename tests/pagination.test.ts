import { describe, expect, it, vi } from "vitest";

// Pagination is pure; keep the unrelated authentication/database graph out of this test.
vi.mock("../apps/api/src/middleware/auth.js", () => ({ actor: vi.fn() }));

import { page } from "../apps/api/src/utils/http";

describe("pagination request compatibility", () => {
  it("preserves defaults and coerces query strings", () => {
    expect(page({})).toEqual({ take: 30, skip: 0 });
    expect(page({ limit: "100", offset: "30" })).toEqual({ take: 100, skip: 30 });
  });

  it("preserves the existing page boundaries", () => {
    expect(page({ limit: 1, offset: 0 })).toEqual({ take: 1, skip: 0 });
    for (const limit of [0, 101, -1, 1.5, "invalid"])
      expect(() => page({ limit })).toThrow();
    for (const offset of [-1, 0.5, "invalid"])
      expect(() => page({ offset })).toThrow();
  });

  it("keeps validation of structured query values instead of trusting them", () => {
    expect(() => page({ limit: { value: "10" } })).toThrow();
    expect(() => page({ offset: ["1", "2"] })).toThrow();
  });
});
