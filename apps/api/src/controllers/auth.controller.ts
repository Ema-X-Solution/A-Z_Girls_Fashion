import type { RequestHandler } from "express";
import { verify } from "argon2";
import { z } from "zod";
import { db, assert, AppError, audit, transaction } from "../lib/db.js";
import { actor, cookieName, cookieOptions, digest, token } from "../middleware/auth.js";
import { isAllowedOrigin } from "../config/origins.js";
import { route } from "../utils/http.js";

export const handlePostAuthLogin: RequestHandler = route(async (req, res) => {
    assert(isAllowedOrigin(req.get("origin")), "CSRF", "Invalid origin", 403);
    const input = z
      .object({
        email: z
          .string()
          .email()
          .transform((v) => v.toLowerCase()),
        password: z.string().min(1).max(256),
      })
      .parse(req.body);
    const user = await db.user.findUnique({ where: { email: input.email } });
    // A real Argon2 verification also runs for unknown users to reduce account enumeration.
    const dummy =
      "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const correct = await verify(
      user?.passwordHash ?? dummy,
      input.password,
    ).catch(() => false);
    if (
      !user ||
      !user.active ||
      (user.lockedUntil && user.lockedUntil > new Date()) ||
      !correct
    ) {
      if (user)
        await transaction(async (tx) => {
          await tx.user.update({
            where: { id: user.id },
            data: {
              failedAttempts: { increment: 1 },
              lockedUntil:
                user.failedAttempts >= 4
                  ? new Date(Date.now() + 900000)
                  : undefined,
            },
          });
          await audit(tx, user.id, "LOGIN_FAILED", user.id);
        });
      throw new AppError(
        401,
        "INVALID_CREDENTIALS",
        "Invalid credentials or account temporarily locked",
      );
    }
    const raw = token(),
      csrf = token();
    await transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { failedAttempts: 0, lockedUntil: null },
      });
      await tx.session.create({
        data: {
          id: digest(raw),
          csrf,
          userId: user.id,
          expiresAt: new Date(Date.now() + 8 * 3600000),
        },
      });
      await audit(tx, user.id, "LOGIN", user.id);
    });
    res
      .cookie(cookieName, raw, { ...cookieOptions, maxAge: 8 * 3600000 })
      .json({ data: { csrf } });
  });

export const handleGetAuthMe: RequestHandler = (req, res) =>
  res.json({ data: { ...actor(req), csrf: req.csrf } });

export const handlePostAuthLogout: RequestHandler = route(async (req, res) => {
    await db.session.delete({ where: { id: req.sessionId } });
    res.clearCookie(cookieName, cookieOptions).json({ data: { ok: true } });
  });

export const handlePostAuthRefresh: RequestHandler = route(async (req, res) => {
    const raw = token(),
      csrf = token();
    await transaction(async (tx) => {
      await tx.session.delete({ where: { id: req.sessionId } });
      await tx.session.create({
        data: {
          id: digest(raw),
          userId: actor(req).id,
          csrf,
          expiresAt: new Date(Date.now() + 8 * 3600000),
        },
      });
    });
    res
      .cookie(cookieName, raw, { ...cookieOptions, maxAge: 8 * 3600000 })
      .json({ data: { csrf } });
  });
