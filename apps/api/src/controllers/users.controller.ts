import { listResult } from "../utils/pagination.js";
import type { RequestHandler } from "express";
import { hash, argon2id } from "argon2";
import { z } from "zod";
import { id, money } from "@az/shared";
import { db, assert, AppError, audit, transaction } from "../lib/db.js";
import { actor } from "../middleware/auth.js";
import { D } from "../utils/money.js";
import { route, uuid, page, text } from "../utils/http.js";

const publicUser = {
  id: true,
  name: true,
  email: true,
  active: true,
  discountLimit: true,
  createdAt: true,
  employeeCode: true,
  roles: { include: { role: { select: { id: true, name: true } } } },
} as const;

export const handleGetUsers: RequestHandler = route(async (req,res)=>{
 const [data,total]=await Promise.all([db.user.findMany({select:publicUser,orderBy:[{createdAt:"desc"},{id:"desc"}],...page(req.query)}),db.user.count()]);
 res.json(listResult(req.query,data,total));
});

export const handlePostUsers: RequestHandler = route(async (req, res) => {
    const input = z
      .object({
        name: text,
        email: z
          .string()
          .email()
          .transform((v) => v.toLowerCase()),
        password: z.string().min(8).max(256),
        roleIds: z.array(id).min(1),
        discountLimit: money.default("0"),
      })
      .parse(req.body);
    assert(
      D(input.discountLimit).lte(100),
      "INVALID_LIMIT",
      "Discount limit exceeds 100",
      400,
    );
    const roles = await db.role.findMany({
      where: { id: { in: input.roleIds } },
    });
    assert(
      roles.length === new Set(input.roleIds).size,
      "INVALID_ROLE",
      "Some roles do not exist",
      400,
    );
    assert(
      actor(req).roles.includes("OWNER") || roles.every((r) => !r.protected),
      "OWNER_PROTECTED",
      "Only owner may assign protected roles",
      403,
    );
    if (!actor(req).roles.includes("OWNER")) {
      const assigned = await db.rolePermission.findMany({
        where: { roleId: { in: input.roleIds } },
      });
      assert(
        assigned.every((p) =>
          actor(req).permissions.includes(p.permissionKey),
        ) && D(input.discountLimit).lte(actor(req).discountLimit),
        "PRIVILEGE_ESCALATION",
        "Cannot grant privileges above your own",
        403,
      );
    }
    const passwordHash = await hash(input.password, { type: argon2id });
    const user = await transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash,
          discountLimit: input.discountLimit,
          employeeCode: undefined,
          roles: { create: input.roleIds.map((roleId) => ({ roleId })) },
        },
        select: publicUser,
      });
      const updated = await tx.user.update({
        where: { id: u.id },
        data: { employeeCode: u.id.slice(0, 8).toUpperCase() },
        select: publicUser,
      });
      await audit(tx, actor(req).id, "USER_CREATE", updated.id);
      return updated;
    });
    res.status(201).json({ data: user });
  });

export const handlePatchUsersById: RequestHandler = route(async (req, res) => {
    const userId = uuid(req.params.id);
    const input = z
      .object({
        name: text.optional(),
        email: z
          .string()
          .email()
          .transform((v) => v.toLowerCase())
          .optional(),
        password: z.string().min(8).max(256).optional(),
        roleIds: z.array(id).min(1).optional(),
        discountLimit: money.optional(),
      })
      .parse(req.body);

    if (input.discountLimit !== undefined) {
      assert(
        D(input.discountLimit).lte(100),
        "INVALID_LIMIT",
        "Discount limit exceeds 100",
        400,
      );
    }

    const updated = await transaction(async (tx) => {
      const u = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { roles: { include: { role: true } } },
      });

      const isTargetOwner = u.roles.some((r) => r.role.protected);
      if (isTargetOwner && !actor(req).roles.includes("OWNER")) {
        throw new AppError(
          403,
          "OWNER_PROTECTED",
          "Only owner may modify owner accounts",
        );
      }

      if (input.email && input.email !== u.email) {
        const existing = await tx.user.findUnique({
          where: { email: input.email },
        });
        assert(!existing, "EMAIL_EXISTS", "Email is already taken", 400);
      }

      if (input.roleIds) {
        const roles = await db.role.findMany({
          where: { id: { in: input.roleIds } },
        });
        assert(
          roles.length === new Set(input.roleIds).size,
          "INVALID_ROLE",
          "Some roles do not exist",
          400,
        );
        assert(
          actor(req).roles.includes("OWNER") || roles.every((r) => !r.protected),
          "OWNER_PROTECTED",
          "Only owner may assign protected roles",
          403,
        );
        if (!actor(req).roles.includes("OWNER")) {
          const assigned = await db.rolePermission.findMany({
            where: { roleId: { in: input.roleIds } },
          });
          assert(
            assigned.every((p) =>
              actor(req).permissions.includes(p.permissionKey),
            ) &&
              (input.discountLimit === undefined ||
                D(input.discountLimit).lte(actor(req).discountLimit)),
            "PRIVILEGE_ESCALATION",
            "Cannot grant privileges above your own",
            403,
          );
        }
        await tx.userRole.deleteMany({ where: { userId } });
        await tx.userRole.createMany({
          data: input.roleIds.map((roleId) => ({ userId, roleId })),
        });
      }

      let passwordHash: string | undefined;
      if (input.password) {
        passwordHash = await hash(input.password, { type: argon2id });
      }

      const resUser = await tx.user.update({
        where: { id: userId },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.email ? { email: input.email } : {}),
          ...(input.discountLimit !== undefined
            ? { discountLimit: input.discountLimit }
            : {}),
          ...(passwordHash
            ? { passwordHash, failedAttempts: 0, lockedUntil: null }
            : {}),
        },
        select: publicUser,
      });

      if (input.password || input.roleIds) {
        if (userId !== actor(req).id) {
          await tx.session.deleteMany({ where: { userId } });
        }
      }

      await audit(tx, actor(req).id, "USER_UPDATE", userId);
      return resUser;
    });

    res.json({ data: updated });
  });

export const handlePatchUsersByIdStatus: RequestHandler = route(async (req, res) => {
    const userId = uuid(req.params.id),
      { active } = z.object({ active: z.boolean() }).parse(req.body);
    await transaction(async (tx) => {
      const u = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { roles: { include: { role: true } } },
      });
      assert(
        !u.roles.some((r) => r.role.protected),
        "OWNER_PROTECTED",
        "Owner accounts cannot be disabled through this endpoint",
        403,
      );
      assert(
        userId !== actor(req).id,
        "SELF_DISABLE",
        "Cannot disable your current account",
      );
      await tx.user.update({ where: { id: userId }, data: { active } });
      await tx.session.deleteMany({ where: { userId } });
      await audit(tx, actor(req).id, "USER_STATUS", userId, { active });
    });
    res.json({ data: { ok: true } });
  });

export const handlePostUsersByIdResetPassword: RequestHandler = route(async (req, res) => {
    const userId = uuid(req.params.id),
      { password } = z
        .object({ password: z.string().min(8).max(256) })
        .parse(req.body);
    const passwordHash = await hash(password, { type: argon2id });
    await transaction(async (tx) => {
      const u = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        include: { roles: { include: { role: true } } },
      });
      assert(
        actor(req).roles.includes("OWNER") ||
          !u.roles.some((r) => r.role.protected),
        "OWNER_PROTECTED",
        "Protected user",
        403,
      );
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, failedAttempts: 0, lockedUntil: null },
      });
      await tx.session.deleteMany({ where: { userId } });
      await audit(tx, actor(req).id, "CREDENTIAL_RESET", userId);
    });
    res.json({ data: { ok: true } });
  });
