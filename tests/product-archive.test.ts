import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { db, type AppError } from "../apps/api/src/lib/db";
import { catalogRouter } from "../apps/api/src/routes/catalog.routes";

const productId = "11111111-1111-4111-8111-111111111111";
const variantId = "22222222-2222-4222-8222-222222222222";
let product: any;
let shipments: any[];
let holds: any[];
let update: ReturnType<typeof vi.fn>;
let audit: ReturnType<typeof vi.fn>;
let transactionSpy: ReturnType<typeof vi.spyOn>;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.actor = {
    id: productId, name: "TEST Owner", email: "owner@example.test",
    roles: ["OWNER"], discountLimit: "0",
    permissions: req.get("x-view-only") ? ["products.view"] : ["products.view", "products.archive"],
  };
  next();
});
app.use("/api", catalogRouter);
app.use((error: AppError, _req: Request, res: Response, _next: NextFunction) => {
  res.status(error instanceof ZodError ? 400 : error.status ?? 500).json({ code: error.code, message: error.message });
});
beforeEach(() => {
  product = { id: productId, nameAr: "TEST Product", status: "ACTIVE", variants: [
    { id: variantId, balances: [{ locationId: "TEST shop", quantity: 0 }, { locationId: "TEST warehouse", quantity: 0 }] },
    { id: "33333333-3333-4333-8333-333333333333", active: false, balances: [{ quantity: 0 }] },
  ] };
  shipments = [];
  holds = [];
  update = vi.fn(async ({ data }) => { product.status = data.status; return product; });
  audit = vi.fn(async () => ({}));
  transactionSpy = vi.spyOn(db, "$transaction").mockImplementation(async (fn: any) => fn({
    product: { findUnique: async () => product, update },
    shipmentItem: { findMany: async () => shipments },
    stockHold: { findMany: async () => holds },
    auditLog: { create: audit },
  }));
});
afterEach(() => vi.restoreAllMocks());
const archive = () => request(app).post(`/api/products/${productId}/archive`).send({});
const restore = () => request(app).post(`/api/products/${productId}/restore`).send({});

describe("product archive stock guard and restore", () => {
  it("archives only after checking every variant and location within a serializable transaction", async () => {
    expect((await archive()).status).toBe(200);
    expect(product.status).toBe("ARCHIVED");
    expect(update).toHaveBeenCalledExactlyOnceWith({ where: { id: productId }, data: { status: "ARCHIVED" } });
    expect(audit).toHaveBeenCalledWith({ data: { userId: productId, action: "PRODUCT_ARCHIVE", reference: productId, details: {} } });
    expect(transactionSpy).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "Serializable" }));
    expect(product.variants[0].balances).toHaveLength(2);
  });
  it.each([1, -1, 20])("blocks nonzero warehouse balances, including %s", async (quantity) => {
    product.variants[0].balances[1].quantity = quantity;
    const result = await archive();
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("PRODUCT_HAS_STOCK");
    expect(result.body.message).toMatch(/[\u0600-\u06ff]/);
    expect(update).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
  it("does not offset stock between locations or ignore inactive variants", async () => {
    product.variants[0].balances[0].quantity = 3;
    product.variants[0].balances[1].quantity = -3;
    expect((await archive()).body.code).toBe("PRODUCT_HAS_STOCK");
    product.variants[0].balances.forEach((balance: any) => { balance.quantity = 0; });
    product.variants[1].balances[0].quantity = 1;
    expect((await archive()).body.code).toBe("PRODUCT_HAS_STOCK");
    expect(update).not.toHaveBeenCalled();
  });
  it("blocks outstanding and partly received shipments", async () => {
    shipments = [{ quantity: 5, received: 0 }];
    expect((await archive()).body.code).toBe("PRODUCT_HAS_STOCK");
    shipments[0].received = 4;
    expect((await archive()).body.code).toBe("PRODUCT_HAS_STOCK");
    expect(update).not.toHaveBeenCalled();
  });
  it("blocks quarantined units until all are released or disposed", async () => {
    holds = [{ quantity: 5, released: 2, disposed: 2 }];
    expect((await archive()).body.code).toBe("PRODUCT_HAS_STOCK");
    expect(update).not.toHaveBeenCalled();
    holds[0].disposed = 3;
    expect((await archive()).status).toBe(200);
  });
  it("allows fully received shipments and resolved holds without deleting history", async () => {
    shipments = [{ quantity: 5, received: 5 }];
    holds = [{ quantity: 5, released: 3, disposed: 2 }];
    expect((await archive()).status).toBe(200);
    expect(shipments).toEqual([{ quantity: 5, received: 5 }]);
    expect(holds).toEqual([{ quantity: 5, released: 3, disposed: 2 }]);
  });
  it("returns 404 for missing products, and rejects repeat archive or restore", async () => {
    product = null;
    expect((await archive()).status).toBe(404);
    expect((await restore()).status).toBe(404);
    product = { id: productId, status: "ARCHIVED", variants: [] };
    expect((await archive()).body.code).toBe("PRODUCT_ALREADY_ARCHIVED");
    expect((await restore()).status).toBe(200);
    expect(product.status).toBe("ACTIVE");
    expect((await restore()).body.code).toBe("PRODUCT_NOT_ARCHIVED");
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith({ data: { userId: productId, action: "PRODUCT_RESTORE", reference: productId, details: {} } });
  });
  it("requires products.archive permission for both actions", async () => {
    for (const action of ["archive", "restore"]) {
      const result = await request(app).post(`/api/products/${productId}/${action}`).set("x-view-only", "1").send({});
      expect(result.status).toBe(403);
      expect(result.body.code).toBe("FORBIDDEN");
    }
    expect(transactionSpy).not.toHaveBeenCalled();
  });
  it("lists archived products only when explicitly requested and preserves search", async () => {
    const findMany = vi.spyOn(db.product, "findMany").mockResolvedValue([]);
    vi.spyOn(db.product, "count").mockResolvedValue(0);
    expect((await request(app).get("/api/products")).status).toBe(200);
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { status: { not: "ARCHIVED" } } }));
    expect((await request(app).get("/api/products?archived=1&q=TEST&offset=30")).status).toBe(200);
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "ARCHIVED", OR: expect.any(Array) }), skip: 30 }));
    expect((await request(app).get("/api/products?archived=wrong")).status).toBe(400);
  });
});
