/**
 * Authentication routes.
 *
 * Email + password against a server-side session. No public registration, no
 * password-reset email flow: for a handful of editors, an administrator
 * assigning a new password (see `routes/users.ts`) is fewer moving parts and
 * one less attack surface than an email-token system.
 */

import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";

import { ApiError, badRequest } from "../lib/errors.js";
import { clientIp, type Env } from "../http.js";
import { requireAuth } from "../middleware/index.js";
import { toPublicUser } from "../repositories/users.js";
import {
  checkPasswordStrength,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "../services/password.js";
import { CSRF_COOKIE, SESSION_COOKIE } from "../services/session.js";

const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address.").max(320),
  password: z.string().min(1, "Enter your password.").max(200),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});

export function authRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  app.post("/login", async (c) => {
    const ctx = c.get("ctx");
    const logger = c.get("logger");
    const body = await c.req.json().catch(() => null);

    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError("bad_request", parsed.error.issues[0]?.message ?? "Invalid request.");
    }

    const { email, password } = parsed.data;
    const ip = clientIp(c);

    // Two buckets: one stops a single address hammering many accounts, the
    // other stops a distributed attempt against one account.
    const ipKey = `ip:${ip}`;
    const accountKey = `account:${email.toLowerCase()}`;

    for (const key of [ipKey, accountKey]) {
      const result = ctx.limiters.login.check(key);
      if (!result.allowed) {
        logger.warn("Login rate limited", { key, ip });
        throw new ApiError(
          "rate_limited",
          `Too many sign-in attempts. Try again in ${Math.ceil(result.retryAfter / 60)} minutes.`,
          { headers: { "retry-after": String(result.retryAfter) } },
        );
      }
    }

    const user = ctx.repositories.users.findByEmail(email);

    // Verify unconditionally. With no user we hash against a malformed record,
    // which costs the same as a real check — so response time does not reveal
    // whether the address exists.
    const valid = await verifyPassword(password, user?.passwordHash ?? "");

    if (!user || !valid) {
      logger.warn("Failed sign-in", { email, ip });
      throw new ApiError("invalid_credentials", "That email address or password is not correct.");
    }

    // Session fixation: any identifier the client already holds is discarded
    // and a fresh one is minted.
    ctx.services.sessions.destroy(getCookie(c, SESSION_COOKIE));

    const { cookie, csrfToken } = ctx.services.sessions.create({
      userId: user.id,
      ip,
      userAgent: c.req.header("user-agent") ?? null,
    });

    ctx.repositories.users.recordLogin(user.id);
    ctx.limiters.login.reset(ipKey);
    ctx.limiters.login.reset(accountKey);

    // Transparently upgrade a hash created under weaker parameters.
    if (needsRehash(user.passwordHash)) {
      ctx.repositories.users.update(user.id, { passwordHash: await hashPassword(password) });
      logger.info("Upgraded password hash parameters", { userId: user.id });
    }

    setCookie(c, SESSION_COOKIE, cookie, ctx.services.sessions.sessionCookieOptions());
    setCookie(c, CSRF_COOKIE, csrfToken, ctx.services.sessions.csrfCookieOptions());

    logger.info("Signed in", { userId: user.id, ip });

    return c.json({
      user: toPublicUser(ctx.repositories.users.findById(user.id)!),
      csrfToken,
    });
  });

  app.post("/logout", async (c) => {
    const ctx = c.get("ctx");
    ctx.services.sessions.destroy(getCookie(c, SESSION_COOKIE));

    deleteCookie(c, SESSION_COOKIE, ctx.services.sessions.clearedCookieOptions());
    deleteCookie(c, CSRF_COOKIE, ctx.services.sessions.clearedCookieOptions());

    return c.json({ ok: true });
  });

  app.get("/me", requireAuth(), (c) => {
    const session = c.get("session");
    return c.json({
      user: toPublicUser(c.get("user")),
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    });
  });

  app.post("/password", requireAuth(), async (c) => {
    const ctx = c.get("ctx");
    const user = c.get("user");
    const parsed = changePasswordSchema.safeParse(await c.req.json().catch(() => null));

    if (!parsed.success) throw badRequest("Enter your current and new password.");

    const { currentPassword, newPassword } = parsed.data;

    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new ApiError("invalid_credentials", "Your current password is not correct.");
    }

    const problem = checkPasswordStrength(newPassword);
    if (problem) throw badRequest(problem);

    if (await verifyPassword(newPassword, user.passwordHash)) {
      throw badRequest("The new password must be different from the current one.");
    }

    ctx.repositories.users.update(user.id, {
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
    });

    // A password change should sign out every other device.
    ctx.services.sessions.destroyAllForUser(user.id, getCookie(c, SESSION_COOKIE));
    c.get("logger").info("Password changed", { userId: user.id });

    return c.json({ ok: true });
  });

  return app;
}
