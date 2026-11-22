import type { RequestHandler, Request } from "express";
import { createHash, randomBytes } from "node:crypto";
import { db, AppError } from "../lib/db.js";
import { isAllowedOrigin } from "../config/origins.js";
export type Actor = {
  id: string;
  name: string;
  email: string;
  permissions: string[];
  roles: string[];
  discountLimit: string;
};
declare module "express-serve-static-core" {
  interface Request {
    actor?: Actor;
    sessionId?: string;
    csrf?: string;
  }
}
export const token = () => randomBytes(32).toString("hex");
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export const cookieName = "az_session";
export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
};
export const authenticate: RequestHandler = async (req, res, next) => {
  try {
    const raw = req.cookies?.[cookieName];
    if (!raw) throw new AppError(401, "UNAUTHENTICATED", "Please sign in");
    const session = await db.session.findUnique({
      where: { id: digest(raw) },
      include: {
        user: {
          include: {
            roles: { include: { role: { include: { permissions: true } } } },
          },
        },
      },
    });
    if (!session || session.expiresAt < new Date() || !session.user.active)
      throw new AppError(401, "SESSION_EXPIRED", "Session expired");
    const u = session.user;
    req.actor = {
      id: u.id,
      name: u.name,
      email: u.email,
      discountLimit: u.discountLimit.toString(),
      roles: u.roles.map((r) => r.role.name),
      permissions: [
        ...new Set(
          u.roles.flatMap((r) =>
            r.role.permissions.map((p) => p.permissionKey),
          ),
        ),
      ],
    };
    req.sessionId = session.id;
    req.csrf = session.csrf;
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (!isAllowedOrigin(req.get("origin")) ||
        req.get("x-csrf-token") !== session.csrf)
    )
      throw new AppError(403, "CSRF", "Invalid request origin or CSRF token");
    next();
  } catch (e) {
    next(e);
  }
};
export const requirePermission =
  (...keys: string[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.actor || !keys.some((k) => req.actor!.permissions.includes(k)))
      next(new AppError(403, "FORBIDDEN", "Permission denied"));
    else next();
  };
export const actor = (req: Request) => req.actor!;
