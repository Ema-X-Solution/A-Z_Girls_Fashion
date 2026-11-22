import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { db, type AppError } from "../apps/api/src/lib/db";
import { D } from "../apps/api/src/utils/money";
import { purchasesRouter } from "../apps/api/src/routes/purchases.routes";

const supplierId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
const variantId = "33333333-3333-4333-8333-333333333333";
const secondId = "44444444-4444-4444-8444-444444444444";
let create: ReturnType<typeof vi.fn>;
let update: ReturnType<typeof vi.fn>;
let audit: ReturnType<typeof vi.fn>;
let findMany: ReturnType<typeof vi.fn>;
let transactionSpy: ReturnType<typeof vi.spyOn>;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.actor = {
    id: supplierId,
    name: "TEST Buyer",
    email: "buyer@example.test",
    roles: [],
    discountLimit: "0",
    permissions: req.get("x-no-create")
      ? ["products.change_price"]
      : [
          "purchases.create",
          ...(req.get("x-price-permission") ? ["products.change_price"] : []),
        ],
  };
  next();
});
app.use("/api", purchasesRouter);
app.use(
  (error: AppError, _req: Request, res: Response, _next: NextFunction) => {
    res
      .status(error instanceof ZodError ? 400 : (error.status ?? 500))
      .json({ code: error.code, message: error.message });
  },
);
beforeEach(() => {
  create = vi.fn(async () => ({ id: locationId, items: [] }));
  update = vi.fn(async () => ({}));
  audit = vi.fn(async () => ({}));
  findMany = vi.fn(async () => [
    { id: variantId, price: D("120.00") },
    { id: secondId, price: D("50.00") },
  ]);
  transactionSpy = vi
    .spyOn(db, "$transaction")
    .mockImplementation(async (fn: any) =>
      fn({
        purchaseOrder: { create },
        productVariant: { findMany, update },
        auditLog: { create: audit },
      }),
    );
});
afterEach(() => vi.restoreAllMocks());
const item = (salePrice: string, id = variantId) => ({
  variantId: id,
  quantity: 1,
  unitCost: "40.00",
  salePrice,
});
const purchase = (items: unknown[], permitted = false) => {
  const req = request(app).post("/api/purchases");
  if (permitted) req.set("x-price-permission", "1");
  return req.send({ supplierId, locationId, items });
};

describe("purchase sale-price permission", () => {
  it.each(["119.99", "120.01", "0"])(
    "rejects a buyer changing sale price to %s before any writes",
    async (price) => {
      const result = await purchase([item(price)]);
      expect(result.status).toBe(403);
      expect(result.body.code).toBe("PRICE_CHANGE_FORBIDDEN");
      expect(result.body.message).toMatch(/[\u0600-\u06ff]/);
      expect(create).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
    },
  );
  it.each(["120", "120.0", "120.00"])(
    "allows the current numeric price %s without price permission",
    async (price) => {
      expect((await purchase([item(price)])).status).toBe(201);
      expect(create).toHaveBeenCalledOnce();
      expect(update).not.toHaveBeenCalled();
      expect(audit).toHaveBeenCalledOnce();
      expect(transactionSpy).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ isolationLevel: "Serializable" }),
      );
    },
  );
  it("checks all lines and duplicate variants before creating the order", async () => {
    for (const items of [
      [item("120"), item("49.99", secondId)],
      [item("120"), item("121")],
    ]) {
      expect((await purchase(items)).status).toBe(403);
      expect(create).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
    }
  });
  it("permits a price-authorized buyer to update prices, including zero", async () => {
    for (const price of ["135.50", "0"]) {
      expect((await purchase([item(price)], true)).status).toBe(201);
      expect(update).toHaveBeenLastCalledWith({
        where: { id: variantId },
        data: { price },
      });
    }
  });
  it("keeps sale price mandatory and preserves purchase-create permission", async () => {
    const missing: Partial<ReturnType<typeof item>> = item("120");
    delete missing.salePrice;
    expect((await purchase([missing], true)).status).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/purchases")
          .set("x-no-create", "1")
          .send({ supplierId, locationId, items: [item("120")] })
      ).status,
    ).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });
  it("checks the fresh database price, not a stale client value", async () => {
    findMany.mockResolvedValue([{ id: variantId, price: D("125") }]);
    expect((await purchase([item("120")])).status).toBe(403);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
