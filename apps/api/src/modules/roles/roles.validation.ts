import { z } from "zod";
import { permissions } from "@az/shared";

export const createRoleSchema = z.object({
  name: z.string().trim().min(1).max(200),
  permissions: z.array(z.enum(permissions)),
});
export const updateRoleSchema = z.object({
  permissions: z.array(z.enum(permissions)),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
