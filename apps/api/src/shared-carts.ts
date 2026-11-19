import { Router } from "express";
import { z } from "zod";
import { id, cartDraftSchema, sharedCartBinding } from "@az/shared";
import {
  actor,
  requirePermission as can,
  digest,
  token,
  type Actor,
} from "./auth.js";
import { db, assert, audit, transaction, type Tx } from "./db.js";
import { once } from "./operations.js";
export const sharedCarts = Router();
sharedCarts.use("/shared-carts", can("sales.create"));
const cartScope = (user: Actor) =>
  user.permissions.includes("sales.view_all") ? {} : { ownerId: user.id };
export async function assertCartLease(
  tx: Tx,
  user: Actor,
  binding: z.infer<typeof sharedCartBinding>,
  locationId?: string,
) {
  await tx.$queryRaw`SELECT id FROM "SharedCart" WHERE id=${binding.id}::uuid FOR UPDATE`;
  const cart = await tx.sharedCart.findUnique({ where: { id: binding.id } });
  assert(
    cart &&
      cart.status === "CLAIMED" &&
      cart.leasedBy === user.id &&
      cart.leaseHash === digest(binding.token) &&
      cart.revision === binding.revision &&
      cart.leaseUntil! > new Date(),
    "CART_LEASE",
    "السلة مستخدمة أو انتهت مهلة حجزها. راجع قائمة السلال المشتركة",
    409,
  );
  assert(
    !locationId || cart.locationId === locationId,
    "CART_LOCATION",
    "استخدم جهازًا يتبع مخزن السلة",
    409,
  );
  return cart;
}
async function reserveCart(
  tx: Tx,
  cartId: string,
  locationId: string,
  draft: z.infer<typeof cartDraftSchema>,
) {
  for (const line of [...draft.items].sort((a, b) =>
    a.variant.id.localeCompare(b.variant.id),
  )) {
    await tx.$queryRaw`SELECT "quantity" FROM "StockBalance" WHERE "variantId"=${line.variant.id}::uuid AND "locationId"=${locationId}::uuid FOR UPDATE`;
    const balance = await tx.stockBalance.findUnique({
      where: {
        variantId_locationId: {
          variantId: line.variant.id,
          locationId: locationId,
        },
      },
    });
    const held =
      (
        await tx.cartReservation.aggregate({
          where: {
            variantId: line.variant.id,
            locationId: locationId,
            expiresAt: { gt: new Date() },
          },
          _sum: { quantity: true },
        })
      )._sum.quantity ?? 0;
    assert(
      balance && balance.quantity - held >= line.quantity,
      "INSUFFICIENT_STOCK",
      "الكمية غير متاحة للحجز",
    );
    await tx.cartReservation.create({
      data: {
        cartId: cartId,
        variantId: line.variant.id,
        locationId: locationId,
        quantity: line.quantity,
        expiresAt: new Date(Date.now() + 30 * 60000),
      },
    });
  }
}

sharedCarts.get("/shared-carts", can("pos.access"), async (req, res, next) => {
  try {
    const skip = z.coerce
      .number()
      .int()
      .min(0)
      .default(0)
      .parse(req.query.offset);
    const where = {
      ...cartScope(actor(req)),
      status: { in: ["AVAILABLE", "CLAIMED"] },
    };
    const [data, total] = await db.$transaction([
      db.sharedCart.findMany({
        where,
        skip,
        take: 30,
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          ownerId: true,
          locationId: true,
          status: true,
          revision: true,
          leasedBy: true,
          leaseUntil: true,
          updatedAt: true,
          reservations: { select: { quantity: true, expiresAt: true } },
        },
      }),
      db.sharedCart.count({ where }),
    ]);
    res.json({ data, total });
  } catch (e) {
    next(e);
  }
});
sharedCarts.post("/shared-carts", can("pos.access"), async (req, res, next) => {
  try {
    const input = z
      .object({
        title: z.string().trim().min(1).max(100),
        locationId: id,
        draft: cartDraftSchema.omit({ sharedCart: true }),
        reserve: z.boolean().default(false),
      })
      .parse(req.body);
    assert(input.draft.items.length, "CART_EMPTY", "السلة فارغة", 400);
    assert(
      new Set(input.draft.items.map((i) => i.variant.id)).size ===
        input.draft.items.length,
      "DUPLICATE_ITEM",
      "اجمع الكميات المتكررة",
      400,
    );
    res.status(201).json({
      data: await once(
        actor(req),
        req.get("Idempotency-Key"),
        "shared-cart-create",
        input,
        async (tx) => {
          assert(
            await tx.stockLocation.findUnique({
              where: { id: input.locationId },
            }),
            "NOT_FOUND",
            "المخزن غير موجود",
            404,
          );
          assert(
            (await tx.sharedCart.count({
              where: {
                ownerId: actor(req).id,
                status: { in: ["AVAILABLE", "CLAIMED"] },
              },
            })) < 50,
            "CART_LIMIT",
            "الحد الأقصى 50 سلة مشتركة",
            400,
          );
          const cart = await tx.sharedCart.create({
            data: {
              title: input.title,
              locationId: input.locationId,
              ownerId: actor(req).id,
              draft: input.draft,
            },
          });
          if (input.reserve)
            await reserveCart(tx, cart.id, input.locationId, input.draft);
          await audit(tx, actor(req).id, "SHARED_CART_SAVE", cart.id, {
            reserved: input.reserve,
          });
          return { id: cart.id, title: cart.title, revision: cart.revision };
        },
      ),
    });
  } catch (e) {
    next(e);
  }
});
sharedCarts.post(
  "/shared-carts/:id/claim",
  can("pos.access"),
  async (req, res, next) => {
    try {
      const cartId = id.parse(req.params.id);
      res.json({
        data: await once(
          actor(req),
          req.get("Idempotency-Key"),
          `cart-claim:${cartId}`,
          {},
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM "SharedCart" WHERE id=${cartId}::uuid FOR UPDATE`;
            const cart = await tx.sharedCart.findFirst({
              where: { id: cartId, ...cartScope(actor(req)) },
            });
            assert(cart, "NOT_FOUND", "السلة غير موجودة", 404);
            assert(
              cart.status === "AVAILABLE" ||
                (cart.status === "CLAIMED" && cart.leaseUntil! < new Date()),
              "CART_BUSY",
              "السلة قيد الاستخدام على جهاز آخر",
            );
            const raw = token();
            const updated = await tx.sharedCart.update({
              where: { id: cartId },
              data: {
                status: "CLAIMED",
                leasedBy: actor(req).id,
                leaseHash: digest(raw),
                syncStamp: 0,
                leaseUntil: new Date(Date.now() + 30 * 60000),
                revision: { increment: 1 },
              },
            });
            await audit(tx, actor(req).id, "SHARED_CART_CLAIM", cartId);
            return {
              draft: cartDraftSchema
                .omit({ sharedCart: true })
                .parse(cart.draft),
              binding: { id: cartId, revision: updated.revision, token: raw },
              locationId: cart.locationId,
              leaseUntil: updated.leaseUntil,
            };
          },
        ),
      });
    } catch (e) {
      next(e);
    }
  },
);
sharedCarts.post(
  "/shared-carts/:id/sync",
  can("pos.access"),
  async (req, res, next) => {
    try {
      const cartId = id.parse(req.params.id),
        input = z
          .object({
            binding: sharedCartBinding,
            stamp: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
            draft: cartDraftSchema.omit({ sharedCart: true }),
          })
          .parse(req.body);
      assert(cartId === input.binding.id, "CART_ID", "سلة غير مطابقة", 400);
      res.json({
        data: await transaction(async (tx) => {
          const cart = await assertCartLease(tx, actor(req), input.binding);
          if (BigInt(input.stamp) <= cart.syncStamp)
            return { ok: true, ignored: true };
          const reserved = await tx.cartReservation.count({
            where: { cartId, expiresAt: { gt: new Date() } },
          });
          await tx.cartReservation.deleteMany({ where: { cartId } });
          if (reserved)
            await reserveCart(tx, cart.id, cart.locationId, input.draft);
          await tx.sharedCart.update({
            where: { id: cartId },
            data: {
              draft: input.draft,
              syncStamp: BigInt(input.stamp),
              leaseUntil: new Date(Date.now() + 30 * 60000),
            },
          });
          return { ok: true };
        }),
      });
    } catch (e) {
      next(e);
    }
  },
);
sharedCarts.post(
  "/shared-carts/:id/release",
  can("pos.access"),
  async (req, res, next) => {
    try {
      const cartId = id.parse(req.params.id),
        input = z
          .object({
            binding: sharedCartBinding,
            draft: cartDraftSchema.omit({ sharedCart: true }),
          })
          .parse(req.body);
      assert(cartId === input.binding.id, "CART_ID", "سلة غير مطابقة", 400);
      res.json({
        data: await transaction(async (tx) => {
          await assertCartLease(tx, actor(req), input.binding);
          await tx.cartReservation.deleteMany({ where: { cartId } });
          const saved = await tx.sharedCart.update({
            where: { id: cartId },
            data: {
              draft: input.draft,
              status: "AVAILABLE",
              revision: { increment: 1 },
              leaseHash: null,
              leasedBy: null,
              leaseUntil: null,
            },
          });
          await audit(tx, actor(req).id, "SHARED_CART_RELEASE", cartId);
          return { id: saved.id };
        }),
      });
    } catch (e) {
      next(e);
    }
  },
);
sharedCarts.post(
  "/shared-carts/:id/cancel",
  can("pos.access"),
  async (req, res, next) => {
    try {
      const cartId = id.parse(req.params.id);
      res.json({
        data: await transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "SharedCart" WHERE id=${cartId}::uuid FOR UPDATE`;
          const cart = await tx.sharedCart.findFirst({
            where: { id: cartId, ...cartScope(actor(req)) },
          });
          assert(cart, "NOT_FOUND", "السلة غير موجودة", 404);
          assert(
            cart.status === "AVAILABLE" ||
              (cart.status === "CLAIMED" && cart.leaseUntil! < new Date()),
            "CART_BUSY",
            "حرر السلة من جهازها أولًا",
          );
          await tx.cartReservation.deleteMany({ where: { cartId } });
          await tx.sharedCart.update({
            where: { id: cartId },
            data: { status: "CANCELLED", leaseHash: null },
          });
          await audit(tx, actor(req).id, "SHARED_CART_CANCEL", cartId);
          return { ok: true };
        }),
      });
    } catch (e) {
      next(e);
    }
  },
);
