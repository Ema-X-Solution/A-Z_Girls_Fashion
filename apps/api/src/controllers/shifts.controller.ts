import type { RequestHandler } from "express";
import { z } from "zod";
import { id, money } from "@az/shared";
import { db, assert, audit } from "../lib/db.js";
import { actor } from "../middleware/auth.js";
import { activeShift, once } from "../services/operations.js";
import { D } from "../utils/money.js";
import { route, uuid, page } from "../utils/http.js";

export const handlePostShiftsOpen: RequestHandler = route(async (req, res) => {
    const input = z
      .object({ registerId: id, openingCash: money })
      .parse(req.body);
    res.status(201).json({
      data: await once(
        actor(req),
        req.get("Idempotency-Key"),
        "open-shift",
        input,
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Register" WHERE id=${input.registerId}::uuid FOR UPDATE`;
          const register = await tx.register.findUnique({
            where: { id: input.registerId },
            include: { branch: true },
          });
          assert(
            register?.active && register.branch.active,
            "REGISTER_INACTIVE",
            "الجهاز أو الفرع غير نشط",
            400,
          );
          const existing = await tx.cashShift.count({
            where: {
              closedAt: null,
              OR: [{ registerId: input.registerId }, { userId: actor(req).id }],
            },
          });
          assert(
            !existing,
            "SHIFT_EXISTS",
            "Register or cashier already has an open shift",
          );
          const s = await tx.cashShift.create({
            data: { ...input, userId: actor(req).id },
          });
          await audit(tx, actor(req).id, "SHIFT_OPEN", s.id);
          return s;
        },
      ),
    });
  });

export const handleGetShiftsCurrent: RequestHandler = route(async (req, res) =>
    res.json({
      data: await db.cashShift.findFirst({
        where: { userId: actor(req).id, closedAt: null },
        include: { register: true },
      }),
    }),
  );

export const handleGetShifts: RequestHandler = route(async (req, res) =>
    res.json({
      data: await db.cashShift.findMany({
        where: { userId: actor(req).id },
        include: { register: true },
        orderBy: { openedAt: "desc" },
        ...page(req.query),
      }),
    }),
  );

export const handlePostShiftsByIdCashMovements: RequestHandler = route(async (req, res) => {
    const shiftId = uuid(req.params.id),
      input = z
        .object({
          type: z.enum(["IN", "OUT"]),
          amount: money.refine((v) => D(v).gt(0)),
          reason: z.string().min(3).max(1000),
        })
        .parse(req.body);
    res.json({
      data: await once(
        actor(req),
        req.get("Idempotency-Key"),
        `cash:${shiftId}`,
        input,
        async (tx) => {
          await activeShift(tx, shiftId, actor(req), false);
          const m = await tx.cashMovement.create({
            data: {
              shiftId,
              userId: actor(req).id,
              type: input.type,
              amount:
                input.type === "IN"
                  ? D(input.amount)
                  : D(input.amount).negated(),
              reason: input.reason,
              reference: crypto.randomUUID(),
            },
          });
          await audit(tx, actor(req).id, "CASH_MOVEMENT", m.id);
          return m;
        },
      ),
    });
  });

export const handlePostShiftsByIdClose: RequestHandler = route(async (req, res) => {
    const shiftId = uuid(req.params.id),
      input = z
        .object({ countedCash: money, notes: z.string().max(2000).default("") })
        .parse(req.body);
    res.json({
      data: await once(
        actor(req),
        req.get("Idempotency-Key"),
        `close:${shiftId}`,
        input,
        async (tx) => {
          const s = await activeShift(
            tx,
            shiftId,
            actor(req),
            true,
          );
          const movements = await tx.cashMovement.aggregate({
              where: { shiftId },
              _sum: { amount: true },
            }),
            expected = s.openingCash.plus(movements._sum.amount ?? 0);
          const closed = await tx.cashShift.update({
            where: { id: shiftId },
            data: {
              countedCash: input.countedCash,
              expectedCash: expected,
              difference: D(input.countedCash).minus(expected),
              notes: input.notes,
              closedAt: new Date(),
            },
          });
          await audit(tx, actor(req).id, "SHIFT_CLOSE", shiftId);
          return closed;
        },
      ),
    });
  });
