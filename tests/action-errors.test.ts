import { describe, expect, it } from "vitest";
import { ApiError } from "../apps/web/src/api";
import { readableError } from "../apps/web/src/app/notifications";

describe("Arabic action errors", () => {
  it("explains the return period without exposing an English server message", () => {
    expect(
      readableError(
        new ApiError(409, "RETURN_PERIOD", "Return period has expired"),
      ),
    ).toContain("انتهت مدة الإرجاع");
  });
  it("translates validation fields and never shows raw English details", () => {
    const message = readableError(
      new ApiError(400, "VALIDATION", "Invalid input", {
        openingCash: ["Use a positive decimal amount"],
        unknown: ["Invalid input"],
      }),
    );
    expect(message).toContain("النقد الافتتاحي");
    expect(message).not.toMatch(/positive|Invalid|unknown|openingCash/);
  });
  it("keeps Arabic business reasons and gives an Arabic fallback for unknown English errors", () => {
    expect(
      readableError(new ApiError(409, "CUSTOM", "راجع الوردية")),
    ).toContain("راجع الوردية");
    expect(
      readableError(new ApiError(500, "CUSTOM", "Internal stack details")),
    ).not.toContain("Internal");
    expect(
      readableError(new ApiError(400, "EXPORT_LIMIT", "too many rows")),
    ).toContain("10,000");
  });
});
