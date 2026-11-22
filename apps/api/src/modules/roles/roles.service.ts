import { db, assert, audit, transaction } from "../../db.js";
import type { CreateRoleInput, UpdateRoleInput } from "./roles.validation.js";

export function listRoles() {
  return db.role.findMany({ include: { permissions: true } });
}

export function createRole(userId: string, input: CreateRoleInput) {
  return transaction(async (tx) => {
    const role = await tx.role.create({
      data: {
        name: input.name,
        permissions: {
          create: input.permissions.map((permissionKey) => ({ permissionKey })),
        },
      },
    });
    await audit(tx, userId, "ROLE_CREATE", role.id);
    return role;
  });
}

export function updateRole(userId: string, roleId: string, input: UpdateRoleInput) {
  return transaction(async (tx) => {
    const role = await tx.role.findUniqueOrThrow({ where: { id: roleId } });
    assert(!role.protected, "OWNER_PROTECTED", "Owner role cannot be modified", 403);
    await tx.rolePermission.deleteMany({ where: { roleId } });
    await tx.rolePermission.createMany({
      data: input.permissions.map((permissionKey) => ({ roleId, permissionKey })),
    });
    await audit(tx, userId, "ROLE_UPDATE", roleId);
  });
}
