import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

const state = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../apps/api/src/lib/db.js", () => {
  const systemSetting = {
    findUnique: async () => ({ key: "store", value: state.value }),
    upsert: async ({
      update,
    }: {
      update: { value: Record<string, unknown> };
    }) => {
      state.value = update.value;
      return { key: "store", value: state.value };
    },
  };
  return {
    db: { systemSetting },
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ systemSetting }),
    audit: vi.fn(),
    AppError: class extends Error {},
  };
});
import {
  handleGetStore,
  handlePatchSettingsStore,
} from "../apps/api/src/controllers/settings.controller";

const fixture = {
  name: "TEST Store",
  currency: "EGP",
  timezone: "Africa/Cairo",
  address: "TEST address",
  phone: "01000000000",
  taxRate: "14.00",
  taxMode: "INCLUSIVE",
  returnDays: 14,
  receiptFooter: "TEST footer",
  receiptWidth: 80,
  invoicePrefix: "INV",
  returnPolicy: "TEST policy",
};
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.actor = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "TEST Owner",
    email: "owner@example.test",
    roles: ["OWNER"],
    permissions: ["settings.manage"],
    discountLimit: "0",
  };
  next();
});
app.get("/store", handleGetStore);
app.patch("/store", handlePatchSettingsStore);
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  res
    .status(error instanceof ZodError ? 400 : 500)
    .json({ error: "invalid settings" });
});
beforeEach(() => {
  state.value = { ...fixture };
});

describe("invoice tax visibility setting", () => {
  it("defaults to ON when an older client saves settings without the new field", async () => {
    const result = await request(app).patch("/store").send(fixture);
    expect(result.status).toBe(200);
    expect((await request(app).get("/store")).body.data.showTaxOnInvoice).toBe(
      true,
    );
  });
  it("persists OFF and ON without changing calculation, branding or policy settings", async () => {
    for (const showTaxOnInvoice of [false, true]) {
      expect(
        (
          await request(app)
            .patch("/store")
            .send({ ...fixture, showTaxOnInvoice })
        ).status,
      ).toBe(200);
      expect((await request(app).get("/store")).body.data).toEqual({
        ...fixture,
        showTaxOnInvoice,
      });
    }
  });
  it("preserves an existing OFF value when an older client omits the field", async () => {
    state.value = { ...fixture, showTaxOnInvoice: false };
    expect((await request(app).patch("/store").send(fixture)).status).toBe(200);
    expect(state.value.showTaxOnInvoice).toBe(false);
  });
  it.each([null, 0, 1, "false", "true", {}, []])(
    "rejects a non-boolean visibility value: %j",
    async (showTaxOnInvoice) => {
      expect(
        (
          await request(app)
            .patch("/store")
            .send({ ...fixture, showTaxOnInvoice })
        ).status,
      ).toBe(400);
      expect(state.value).toEqual(fixture);
    },
  );
});
