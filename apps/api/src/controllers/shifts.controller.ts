import { listResult } from "../utils/pagination.js";
import type { RequestHandler } from "express";
import { z } from "zod";
import { id, money } from "@az/shared";
import { db, assert, audit } from "../lib/db.js";
import { actor } from "../middleware/auth.js";
import { activeShift, once } from "../services/operations.js";
import { D } from "../utils/money.js";
import { route, uuid, page } from "../utils/http.js";

const cairoDay = (value: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
// One physical drawer. Serialize opening and reopening across users/registers.
const lockDrawer = (tx: import("../lib/db.js").Tx) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('shared-store-drawer', 0))`;

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
        await lockDrawer(tx);
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
          },
        });
        assert(
          !existing,
          "SHIFT_EXISTS",
          "درج المحل له وردية مفتوحة بالفعل. استخدم الوردية الحالية.",
        );
        const latest = await tx.cashShift.findFirst({
          orderBy: { openedAt: "desc" },
        });
        assert(
          !latest || cairoDay(latest.openedAt) !== cairoDay(new Date()),
          "SHIFT_REOPEN_REQUIRED",
          "وردية اليوم اتقفلت بالفعل. أعد فتح نفس الوردية بدل فتح وردية جديدة.",
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
      where: { closedAt: null },
      orderBy: { openedAt: "desc" },
      include: { register: true },
    }),
  }),
);

export const handleGetShifts: RequestHandler = route(async(req,res)=>{
const [data,total]=await Promise.all([db.cashShift.findMany({include:{register:true},orderBy:[{openedAt:"desc"},{id:"desc"}],...page(req.query)}),db.cashShift.count()]);const latest=await db.cashShift.findFirst({where:{closedAt:{not:null}},orderBy:[{openedAt:"desc"},{id:"desc"}],include:{register:true}});res.json({...listResult(req.query,data,total),todayClosed:latest&&cairoDay(latest.openedAt)===cairoDay(new Date())?latest:null});
});

export const handlePostShiftsByIdCashMovements: RequestHandler = route(
  async (req, res) => {
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
  },
);

export const handlePostShiftsByIdClose: RequestHandler = route(
  async (req, res) => {
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
          const s = await activeShift(tx, shiftId, actor(req), true);
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
          await audit(tx, actor(req).id, "SHIFT_CLOSE", shiftId, {
            countedCash: String(closed.countedCash),
            expectedCash: String(closed.expectedCash),
            difference: String(closed.difference),
            notes: closed.notes,
          });
          return closed;
        },
      ),
    });
  },
);

export const handlePostShiftsByIdReopen: RequestHandler = route(
  async (req, res) => {
    const shiftId = uuid(req.params.id);
    res.json({
      data: await once(
        actor(req),
        req.get("Idempotency-Key"),
        `reopen:${shiftId}`,
        {},
        async (tx) => {
          await lockDrawer(tx);
          await tx.$queryRaw`SELECT id FROM "CashShift" WHERE id=${shiftId}::uuid FOR UPDATE`;
          const shift = await tx.cashShift.findUnique({
            where: { id: shiftId },
          });
          assert(shift, "NOT_FOUND", "الوردية غير موجودة", 404);
          assert(
            shift.closedAt,
            "SHIFT_ALREADY_OPEN",
            "الوردية مفتوحة بالفعل.",
          );
          assert(
            cairoDay(shift.openedAt) === cairoDay(new Date()),
            "SHIFT_REOPEN_DAY",
            "إعادة الفتح متاحة لوردية اليوم فقط بتوقيت القاهرة.",
          );
          assert(
            !(await tx.cashShift.count({ where: { closedAt: null } })),
            "SHIFT_EXISTS",
            "توجد وردية مفتوحة للدرج بالفعل.",
          );
          await audit(tx, actor(req).id, "SHIFT_REOPEN", shift.id, {
            previousClosedAt: shift.closedAt.toISOString(),
            previousCountedCash: String(shift.countedCash),
            previousExpectedCash: String(shift.expectedCash),
            previousDifference: String(shift.difference),
            previousNotes: shift.notes,
          });
          return tx.cashShift.update({
            where: { id: shiftId },
            data: {
              closedAt: null,
              countedCash: null,
              expectedCash: null,
              difference: null,
            },
          });
        },
      ),
    });
  },
);
