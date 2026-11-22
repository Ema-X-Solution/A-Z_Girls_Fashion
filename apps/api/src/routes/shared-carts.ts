import { Router } from "express";
import { requirePermission as can } from "../middleware/auth.js";
import * as controllers from "../controllers/shared-carts.controller.js";
export { assertCartLease } from "../controllers/shared-carts.controller.js";

export const sharedCarts = Router();

sharedCarts.use("/shared-carts", can("sales.create"));

sharedCarts.get("/shared-carts", can("pos.access"), controllers.handleGetSharedCarts);

sharedCarts.post("/shared-carts", can("pos.access"), controllers.handlePostSharedCarts);

sharedCarts.post(
  "/shared-carts/:id/claim",
  can("pos.access"),
  controllers.handlePostSharedCartsByIdClaim,
);

sharedCarts.post(
  "/shared-carts/:id/sync",
  can("pos.access"),
  controllers.handlePostSharedCartsByIdSync,
);

sharedCarts.post(
  "/shared-carts/:id/release",
  can("pos.access"),
  controllers.handlePostSharedCartsByIdRelease,
);

sharedCarts.post(
  "/shared-carts/:id/cancel",
  can("pos.access"),
  controllers.handlePostSharedCartsByIdCancel,
);
