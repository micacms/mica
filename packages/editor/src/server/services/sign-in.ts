/**
 * Turning "who this is" into a session.
 *
 * Separate from the auth routes because two entry points need it and neither
 * may depend on the other: the OIDC callback, which has just been told who
 * somebody is by a provider, and the admin page itself in local mode, where
 * there is nobody to ask.
 */

import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";

import type { AppContext } from "../context.js";
import { clientIp, type Env } from "../http.js";
import { DEFAULT_SITE_ID } from "../repositories/sites.js";
import { CSRF_COOKIE, SESSION_COOKIE } from "./session.js";

/** The implicit identity local mode signs everything in as. */
export const LOCAL_DEVELOPER = {
  email: "developer@localhost",
  name: "Local developer",
} as const;

/** Issues the session cookies for a user who has just been identified. */
export function establishSession(c: Context<Env>, userId: string): void {
  const ctx = c.get("ctx");

  // Session fixation: discard whatever identifier the client already holds.
  ctx.services.sessions.destroy(getCookie(c, SESSION_COOKIE));

  const { cookie, csrfToken } = ctx.services.sessions.create({
    userId,
    ip: clientIp(c),
    userAgent: c.req.header("user-agent") ?? null,
  });

  ctx.repositories.users.recordLogin(userId);

  setCookie(c, SESSION_COOKIE, cookie, ctx.services.sessions.sessionCookieOptions());
  setCookie(c, CSRF_COOKIE, csrfToken, ctx.services.sessions.csrfCookieOptions());
}

/**
 * Local mode: the developer account, created on demand.
 *
 * There is no credential because there is nothing to check. This is only ever
 * reached when `MICA_MODE=local`, which the config layer refuses in production
 * and refuses on any host but this one.
 */
export function signInLocalDeveloper(ctx: AppContext): string {
  const { users, memberships } = ctx.repositories;

  const user =
    users.findByEmail(LOCAL_DEVELOPER.email) ??
    users.create({ email: LOCAL_DEVELOPER.email, name: LOCAL_DEVELOPER.name });

  if (!memberships.find(DEFAULT_SITE_ID, user.id)) {
    memberships.grant({ siteId: DEFAULT_SITE_ID, userId: user.id, role: "admin" });
  }

  return user.id;
}

/**
 * The whole of sign-in on a developer's own machine: opening the editor is the
 * sign-in, because a mode with no identity provider has nothing to ask and
 * nothing to verify.
 *
 * Called while serving the admin page, which is a top-level navigation and so
 * the one place a cookie can be set without a round trip the person can see.
 * Doing it here rather than in the API means the SPA never loads without a
 * session, never gets a 401 it has to interpret, and never shows a sign-in
 * screen whose only button says "yes, obviously".
 *
 * Deliberately not middleware on the API: a request that arrives without a
 * session still gets 401 there, so signing out stays real and the
 * authorization tests keep testing authorization.
 */
export function signInLocalDeveloperOnPageLoad(c: Context<Env>): void {
  const ctx = c.get("ctx");
  if (!ctx.config.authDisabled) return;
  if (ctx.services.sessions.resolve(getCookie(c, SESSION_COOKIE))) return;

  establishSession(c, signInLocalDeveloper(ctx));
}
