import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "../apps/api/src/lib/db";
import { createRole } from "../apps/api/src/services/roles.service";

afterEach(() => vi.restoreAllMocks());
describe("role duplicate save error", () => {
  it("maps the unique-name conflict to a clear Arabic business error", async () => {
    vi.spyOn(db, "$transaction").mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["name"] },
      }),
    );
    await expect(
      createRole("test-owner", {
        name: "TEST existing",
        permissions: ["sales.create"],
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "ROLE_NAME_EXISTS",
      message: expect.stringContaining("اسم الدور مسجل بالفعل"),
    });
  });
  it("does not hide unrelated database failures as duplicate names", async () => {
    const error = new Error("database unavailable");
    vi.spyOn(db, "$transaction").mockRejectedValue(error);
    await expect(
      createRole("test-owner", {
        name: "TEST existing",
        permissions: ["sales.create"],
      }),
    ).rejects.toBe(error);
  });
});
