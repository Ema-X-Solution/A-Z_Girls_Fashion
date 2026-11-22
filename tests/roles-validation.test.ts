import { describe, expect, it } from "vitest";
import { createRoleSchema, updateRoleSchema } from "../apps/api/src/modules/roles/roles.validation";

describe("role request validation compatibility", () => {
  it("trims names and preserves permission order and duplicates", () => {
    expect(createRoleSchema.parse({
      name: "  Sales  ",
      permissions: ["sales.create", "sales.view_own", "sales.create"],
    })).toEqual({
      name: "Sales",
      permissions: ["sales.create", "sales.view_own", "sales.create"],
    });
  });

  it("rejects blank or overlong names and unknown permissions", () => {
    for (const name of ["  ", "x".repeat(201)])
      expect(createRoleSchema.safeParse({ name, permissions: [] }).success).toBe(false);
    expect(updateRoleSchema.safeParse({ permissions: ["unknown.permission"] }).success).toBe(false);
  });

  it("allows clearing permissions and strips unrelated update fields", () => {
    expect(updateRoleSchema.parse({ permissions: [], name: "ignored" }))
      .toEqual({ permissions: [] });
  });
});
