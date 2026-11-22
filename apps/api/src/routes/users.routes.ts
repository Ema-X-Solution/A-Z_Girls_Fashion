import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/users.controller.js";

export const usersRouter = Router();

usersRouter.get(
  "/users",
  can("users.manage"),
  controllers.handleGetUsers,
);

usersRouter.post(
  "/users",
  can("users.manage"),
  controllers.handlePostUsers,
);

usersRouter.patch(
  "/users/:id",
  can("users.manage"),
  controllers.handlePatchUsersById,
);

usersRouter.patch(
  "/users/:id/status",
  can("users.manage"),
  controllers.handlePatchUsersByIdStatus,
);

usersRouter.post(
  "/users/:id/reset-password",
  can("users.manage"),
  controllers.handlePostUsersByIdResetPassword,
);
