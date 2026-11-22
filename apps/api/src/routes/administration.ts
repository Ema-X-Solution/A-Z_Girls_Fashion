import { Router } from "express";
import { z } from "zod";
import { id } from "@az/shared";
import { actor, requirePermission as can } from "../middleware/auth.js";
import { db, assert, audit, transaction } from "../lib/db.js";
export const administration = Router();
administration.get(
  "/administration/branches",
  can("settings.manage"),
  async (_req, res, next) => {
    try {
      res.json({
        data: await db.branch.findMany({
          include: {
            locations: true,
            registers: {
              include: { location: true, _count: { select: { shifts: true } } },
            },
          },
          orderBy: { name: "asc" },
        }),
      });
    } catch (e) {
      next(e);
    }
  },
);
administration.post(
  "/administration/branches",
  can("settings.manage"),
  async (req, res, next) => {
    try {
      const input = z
        .object({
          name: z.string().trim().min(1).max(150),
          locationName: z.string().trim().min(1).max(150),
        })
        .parse(req.body);
      res.status(201).json({
        data: await transaction(async (tx) => {
          const branch = await tx.branch.create({
            data: {
              name: input.name,
              locations: { create: { name: input.locationName } },
            },
            include: { locations: true },
          });
          await audit(tx, actor(req).id, "BRANCH_CREATE", branch.id);
          return branch;
        }),
      });
    } catch (e) {
      next(e);
    }
  },
);
administration.patch(
  "/administration/branches/:id",
  can("settings.manage"),
  async (req, res, next) => {
    try {
      const branchId = id.parse(req.params.id),
        input = z
          .object({
            name: z.string().trim().min(1).max(150),
            active: z.boolean(),
          })
          .parse(req.body);
      res.json({
        data: await transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Branch" WHERE id=${branchId}::uuid FOR UPDATE`;
          if (!input.active)
            assert(
              !(await tx.cashShift.count({
                where: { closedAt: null, register: { branchId } },
              })),
              "OPEN_SHIFT",
              "أغلق ورديات الفرع أولًا",
            );
          const result = await tx.branch.update({
            where: { id: branchId },
            data: input,
          });
          await audit(tx, actor(req).id, "BRANCH_UPDATE", branchId, input);
          return result;
        }),
      });
    } catch (e) {
      next(e);
    }
  },
);
administration.post(
  "/administration/registers",
  can("settings.manage"),
  async (req, res, next) => {
    try {
      const input = z
        .object({
          name: z.string().trim().min(1).max(150),
          branchId: id,
          locationId: id,
        })
        .parse(req.body);
      res.status(201).json({
        data: await transaction(async (tx) => {
          const location = await tx.stockLocation.findUnique({
            where: { id: input.locationId },
            include: { branch: true },
          });
          assert(
            location?.branchId === input.branchId && location.branch.active,
            "REGISTER_LOCATION",
            "اختار مخزنًا داخل الفرع النشط",
            400,
          );
          const register = await tx.register.create({ data: input });
          await audit(tx, actor(req).id, "REGISTER_CREATE", register.id);
          return register;
        }),
      });
    } catch (e) {
      next(e);
    }
  },
);
administration.patch(
  "/administration/registers/:id",
  can("settings.manage"),
  async (req, res, next) => {
    try {
      const registerId = id.parse(req.params.id),
        input = z
          .object({
            name: z.string().trim().min(1).max(150),
            locationId: id,
            active: z.boolean(),
          })
          .parse(req.body);
      res.json({
        data: await transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "Register" WHERE id=${registerId}::uuid FOR UPDATE`;
          const register = await tx.register.findUnique({
            where: { id: registerId },
          });
          assert(register, "NOT_FOUND", "الجهاز غير موجود", 404);
          assert(
            !(await tx.cashShift.count({
              where: { registerId, closedAt: null },
            })),
            "OPEN_SHIFT",
            "أغلق وردية الجهاز قبل تعديله",
          );
          const location = await tx.stockLocation.findUnique({
            where: { id: input.locationId },
          });
          assert(
            location?.branchId === register.branchId,
            "REGISTER_LOCATION",
            "المخزن يجب أن يتبع الفرع نفسه",
            400,
          );
          const updated = await tx.register.update({
            where: { id: registerId },
            data: input,
          });
          await audit(tx, actor(req).id, "REGISTER_UPDATE", registerId, input);
          return updated;
        }),
      });
    } catch (e) {
      next(e);
    }
  },
);
administration.get(
  "/administration/sessions",
  can("users.manage"),
  async (req, res, next) => {
    try {
      const skip = z.coerce
        .number()
        .int()
        .min(0)
        .default(0)
        .parse(req.query.offset);
      const where = { expiresAt: { gt: new Date() } };
      const [data, total] = await db.$transaction([
        db.session.findMany({
          where,
          skip,
          take: 30,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            userId: true,
            createdAt: true,
            expiresAt: true,
            user: { select: { name: true, email: true } },
          },
        }),
        db.session.count({ where }),
      ]);
      res.json({
        data: data.map((s) => ({ ...s, current: s.id === req.sessionId })),
        total,
      });
    } catch (e) {
      next(e);
    }
  },
);
administration.post(
  "/administration/sessions/:id/revoke",
  can("users.manage"),
  async (req, res, next) => {
    try {
      const sessionId = z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(req.params.id);
      await transaction(async (tx) => {
        const session = await tx.session.findUnique({
          where: { id: sessionId },
        });
        assert(session, "NOT_FOUND", "الجلسة غير موجودة", 404);
        await tx.session.delete({ where: { id: sessionId } });
        await audit(tx, actor(req).id, "SESSION_REVOKE", session.userId);
      });
      res.json({ data: { ok: true } });
    } catch (e) {
      next(e);
    }
  },
);
administration.post(
  "/administration/users/:id/revoke-sessions",
  can("users.manage"),
  async (req, res, next) => {
    try {
      const userId = id.parse(req.params.id);
      await transaction(async (tx) => {
        await tx.session.deleteMany({ where: { userId } });
        await audit(tx, actor(req).id, "USER_SESSIONS_REVOKE", userId);
      });
      res.json({ data: { ok: true } });
    } catch (e) {
      next(e);
    }
  },
);
administration.patch(
  "/administration/users/:id/role",
  can("roles.manage"),
  can("users.manage"),
  async (req, res, next) => {
    try {
      const userId = id.parse(req.params.id),
        { roleId } = z.object({ roleId: id }).parse(req.body);
      await transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId}::uuid FOR UPDATE`;
        const user = await tx.user.findUnique({
            where: { id: userId },
            include: { roles: { include: { role: true } } },
          }),
          role = await tx.role.findUnique({ where: { id: roleId } });
        assert(user && role, "NOT_FOUND", "المستخدم أو الدور غير موجود", 404);
        assert(
          userId !== actor(req).id &&
            !user.roles.some((r) => r.role.protected) &&
            !role.protected,
          "PROTECTED_OWNER",
          "حساب المالك ودوره محميان",
          403,
        );
        if (!actor(req).roles.includes("OWNER")) {
          const grants = await tx.rolePermission.findMany({
            where: { roleId },
          });
          assert(
            grants.every((p) =>
              actor(req).permissions.includes(p.permissionKey),
            ),
            "PRIVILEGE_ESCALATION",
            "لا يمكن منح صلاحيات أعلى من صلاحياتك",
            403,
          );
        }
        await tx.userRole.deleteMany({ where: { userId } });
        await tx.userRole.create({ data: { userId, roleId } });
        await tx.session.deleteMany({ where: { userId } });
        await audit(tx, actor(req).id, "USER_ROLE_CHANGE", userId, { roleId });
      });
      res.json({ data: { ok: true } });
    } catch (e) {
      next(e);
    }
  },
);
