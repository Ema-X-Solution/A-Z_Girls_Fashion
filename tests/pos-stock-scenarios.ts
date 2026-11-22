import { it, expect } from "vitest";
import { emptyDraft } from "../apps/web/src/features/pos/workspace";

export function registerPosStockTests(get: () => any) {
  it("sells the last piece despite legacy reservation rows, preserves their data and retires shared-cart endpoints", async () => {
    const { db, owner, send, resetFixtureQuota } = get();
    await resetFixtureQuota();
    const shift = (await owner.agent.get("/api/shifts/current")).body.data;
    expect(shift).not.toBeNull();
    const register = await db.register.findUniqueOrThrow({
      where: { id: shift.registerId },
    });
    const category = await db.category.findFirstOrThrow();
    const result = await send(owner, "/products", {
      nameAr: "TEST POS last piece regression",
      sku: "POS-LAST-PIECE",
      categoryId: category.id,
      variants: [{ sku: "POS-LAST-PIECE-V1", price: "10", cost: "2" }],
    });
    expect(result.status).toBe(201);
    const variant = result.body.data.variants[0];
    expect(
      (
        await send(owner, "/inventory/adjustments", {
          locationId: register.locationId,
          variantId: variant.id,
          quantity: 1,
          cost: "2",
          reason: "TEST POS last piece fixture",
        })
      ).status,
    ).toBe(200);
    const draft = emptyDraft();
    const legacy = await db.sharedCart.create({
      data: {
        title: "TEST retained legacy cart",
        ownerId: owner.user.id,
        locationId: register.locationId,
        draft,
      },
    });
    await db.cartReservation.create({
      data: {
        cartId: legacy.id,
        variantId: variant.id,
        locationId: register.locationId,
        quantity: 1,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
    const checkout = (quantity: number) => ({
      shiftId: shift.id,
      items: [{ variantId: variant.id, quantity }],
      payments: [{ method: "CASH", amount: String(quantity * 10) }],
    });
    const shortage = await send(owner, "/sales", checkout(2));
    expect(shortage.status).toBe(409);
    expect(shortage.body.error.code).toBe("INSUFFICIENT_STOCK");
    const legacyRequest = await send(owner, "/sales", {
      ...checkout(1),
      sharedCart: { id: legacy.id, revision: 1, token: "0".repeat(64) },
    });
    expect(legacyRequest.status).toBe(400);
    const sold = await send(owner, "/sales", checkout(1));
    expect(sold.status).toBe(201);
    const where = {
      variantId_locationId: {
        variantId: variant.id,
        locationId: register.locationId,
      },
    };
    expect((await db.stockBalance.findUniqueOrThrow({ where })).quantity).toBe(
      0,
    );
    expect(await db.sharedCart.count({ where: { id: legacy.id } })).toBe(1);
    expect(
      await db.cartReservation.count({ where: { cartId: legacy.id } }),
    ).toBe(1);
    const empty = await send(owner, "/sales", checkout(1));
    expect(empty.status).toBe(409);
    expect(empty.body.error.code).toBe("INSUFFICIENT_STOCK");
    expect((await owner.agent.get("/api/shared-carts")).status).toBe(404);
    expect((await send(owner, "/shared-carts", {})).status).toBe(404);
    for (const action of ["claim", "sync", "release", "cancel"])
      expect(
        (await send(owner, `/shared-carts/${legacy.id}/${action}`, {})).status,
      ).toBe(404);
  });
      }
