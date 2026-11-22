import type { RequestHandler } from "express";
import { z } from "zod";
import { actor, digest } from "../middleware/auth.js";
import { audit, transaction } from "../lib/db.js";

const attemptKey = z.string().regex(/^[\w-]{16,100}$/);

async function inspect(
  user: ReturnType<typeof actor>,
  key: string,
  cancel: boolean,
) {
  const scoped = digest(`${user.id}:checkout:${key}`);
  return transaction(async (tx) => {
    // Same lock as checkout: cancellation wins before posting, or returns the
    // committed receipt. A delayed original request cannot post after cancel.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scoped}, 0))`;
    const existing = await tx.idempotencyKey.findUnique({
      where: { key: scoped },
    });
    if (existing) {
      const response = existing.response as any;
      return response?.checkoutCancelled
        ? { status: "CANCELLED" }
        : { status: "COMPLETED", saleId: response.id };
    }
    if (!cancel) return { status: "UNKNOWN" };
    await tx.idempotencyKey.create({
      data: {
        key: scoped,
        userId: user.id,
        operation: "checkout",
        hash: "CANCELLED",
        response: { checkoutCancelled: true },
      },
    });
    await audit(tx, user.id, "CHECKOUT_CANCELLED", key);
    return { status: "CANCELLED" };
  });
}

export const handleGetCheckoutAttemptsByKey: RequestHandler = async (req, res, next) => {
    try {
      res.json({
        data: await inspect(
          actor(req),
          attemptKey.parse(req.params.key),
          false,
        ),
      });
    } catch (e) {
      next(e);
    }
  };

export const handlePostCheckoutAttemptsByKeyCancel: RequestHandler = async (req, res, next) => {
    try {
      res.json({
        data: await inspect(actor(req), attemptKey.parse(req.params.key), true),
      });
    } catch (e) {
      next(e);
    }
  };
