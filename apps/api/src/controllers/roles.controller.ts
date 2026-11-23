import { page } from "../utils/http.js";
import { listResult, usesPagination } from "../utils/pagination.js";
import type { RequestHandler } from "express";
import { id, permissions } from "@az/shared";
import { actor } from "../middleware/auth.js";
import { assert, db } from "../lib/db.js";
import { createRoleSchema, updateRoleSchema } from "../validators/roles.validation.js";
import { listRoles, createRole, updateRole } from "../services/roles.service.js";

export const handleGetRoles: RequestHandler = async (req, res) => {
  if(usesPagination(req.query)){const [data,total]=await Promise.all([db.role.findMany({include:{permissions:true},orderBy:[{name:"asc"},{id:"asc"}],...page(req.query)}),db.role.count()]);res.json(listResult(req.query,data,total));return;}
  res.json({ data: await listRoles() });
};

export const handleGetPermissions: RequestHandler = (_req, res) => {
  res.json({ data: permissions });
};

export const handlePostRoles: RequestHandler = async (req, res) => {
  assert(actor(req).roles.includes("OWNER"), "OWNER_REQUIRED", "Only owner can manage roles", 403);
  const input = createRoleSchema.parse(req.body);
  const role = await createRole(actor(req).id, input);
  res.status(201).json({ data: role });
};

export const handlePatchRolesById: RequestHandler = async (req, res) => {
  assert(actor(req).roles.includes("OWNER"), "OWNER_REQUIRED", "Only owner can manage roles", 403);
  const roleId = id.parse(req.params.id);
  const input = updateRoleSchema.parse(req.body);
  await updateRole(actor(req).id, roleId, input);
  res.json({ data: { ok: true } });
};
