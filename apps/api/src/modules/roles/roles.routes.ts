import { Router } from "express";
import { id, permissions } from "@az/shared";
import { actor, requirePermission as can } from "../../auth.js";
import { assert } from "../../db.js";
import { createRoleSchema, updateRoleSchema } from "./roles.validation.js";
import { listRoles, createRole, updateRole } from "./roles.service.js";

export const roles = Router();

roles.get("/roles", can("users.manage", "roles.manage"), async (_req, res) => {
  res.json({ data: await listRoles() });
});
roles.get("/permissions", can("roles.manage"), (_req, res) => {
  res.json({ data: permissions });
});
roles.post("/roles", can("roles.manage"), async (req, res) => {
  assert(actor(req).roles.includes("OWNER"), "OWNER_REQUIRED", "Only owner can manage roles", 403);
  const input = createRoleSchema.parse(req.body);
  const role = await createRole(actor(req).id, input);
  res.status(201).json({ data: role });
});
roles.patch("/roles/:id", can("roles.manage"), async (req, res) => {
  assert(actor(req).roles.includes("OWNER"), "OWNER_REQUIRED", "Only owner can manage roles", 403);
  const roleId = id.parse(req.params.id);
  const input = updateRoleSchema.parse(req.body);
  await updateRole(actor(req).id, roleId, input);
  res.json({ data: { ok: true } });
});
