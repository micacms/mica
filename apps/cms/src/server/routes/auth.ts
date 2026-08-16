/**
 * Authentication routes.
 *
 * The authorization code flow, and nothing else. There is no login form here,
 * no password check and no reset: the browser is sent to an identity provider,
 * comes back with a code, and Mica exchanges it for a statement about who the
 * person is.
 *
 * What Mica still decides is whether that person may edit *this site*. A valid
 * token from a correctly configured provider gets you a `users` row and
 * nothing more; the `memberships` table is the gate, and an unknown person
 * hits it.
 *
 * In local mode there is no provider and no authentication at all, and no
 * route here to reach either: serving the admin page signs the developer in
 * (see `services/sign-in.ts`), so nobody meets a sign-in screen on their own
 * machine. `/login` still works, for a bookmark that predates the session. The
 * config layer refuses that mode anywhere it could be reached by someone else.
 */

import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { ApiError } from "../lib/errors.js";
import { clientIp, type Env } from "../http.js";
import { requireAuth } from "../middleware/index.js";
import { DEFAULT_SITE_ID } from "../repositories/sites.js";
import type { AppContext } from "../context.js";
import { CSRF_COOKIE, SESSION_COOKIE } from "../services/session.js";
import { establishSession, signInLocalDeveloper } from "../services/sign-in.js";
import {
  openTransaction,
  sealTransaction,
  TRANSACTION_COOKIE,
  type OidcClaims,
} from "../services/oidc.js";

/**
 * Turns a set of claims into a signed-in user.
 *
 * The subject is the account key, never the email — a provider that lets a
 * person change their address must not thereby let them take over somebody
 * else's Mica account. An email that has moved is simply updated on the row
 * the subject already points at.
 */
function resolveUser(ctx: AppContext, claims: OidcClaims): string {
  const { users, identities, memberships } = ctx.repositories;

  const existing = identities.find(claims.issuer, claims.subject);
  if (existing) {
    const user = users.findById(existing.userId);
    // The provider is authoritative for both, so keep them current.
    if (user && (user.email !== claims.email.toLowerCase() || user.name !== claims.name)) {
      users.update(user.id, { email: claims.email, name: claims.name });
    }
    return existing.userId;
  }

  /**
   * A first sign-in for this subject.
   *
   * If a user already holds the address, this is almost always the same person
   * arriving through a newly configured provider, so the identity is linked to
   * the existing row rather than creating a duplicate account. That does mean
   * trusting the provider's `email` claim once, at link time — which is why a
   * deployment should point Mica at one provider it controls, and why the
   * subject takes over as the key immediately afterwards.
   */
  const byEmail = users.findByEmail(claims.email);
  const userId = byEmail?.id ?? users.create({ email: claims.email, name: claims.name }).id;

  identities.link({ issuer: claims.issuer, subject: claims.subject, userId });

  /**
   * Bootstrap. An empty deployment has no members, so nobody could ever be
   * granted one — the first configured administrator breaks that circle.
   */
  const bootstrap = ctx.config.OIDC_BOOTSTRAP_ADMIN?.trim().toLowerCase();
  if (bootstrap && bootstrap === claims.email.toLowerCase()) {
    memberships.grant({ siteId: DEFAULT_SITE_ID, userId, role: "admin" });
  }

  return userId;
}

/** Only ever a path on this server, so the callback cannot be an open redirect. */
function safeReturnTo(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/admin/";
  return raw;
}

export function authRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  /**
   * What the sign-in screen needs to know before it draws anything.
   *
   * Public: it reveals only which provider this deployment uses, which the
   * redirect would reveal a moment later anyway.
   */
  app.get("/config", (c) => {
    const { config } = c.get("ctx");
    return c.json({
      mode: config.MICA_MODE,
      authDisabled: config.authDisabled,
      provider: config.OIDC_ISSUER ? new URL(config.OIDC_ISSUER).hostname : null,
    });
  });

  /** Starts the flow. A redirect, not a form post. */
  app.get("/login", async (c) => {
    const ctx = c.get("ctx");
    const returnTo = safeReturnTo(c.req.query("returnTo"));

    if (ctx.config.authDisabled) {
      establishSession(c, signInLocalDeveloper(ctx));
      c.get("logger").warn("Signed in without authentication (MICA_MODE=local)");
      return c.redirect(returnTo);
    }

    // Rate limited on the way out as well as the way back: starting a flow is
    // cheap for a client and costs Mica a discovery request.
    const limit = ctx.limiters.login.check(`oidc:${clientIp(c)}`);
    if (!limit.allowed) {
      throw new ApiError(
        "rate_limited",
        `Too many sign-in attempts. Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.`,
        { headers: { "retry-after": String(limit.retryAfter) } },
      );
    }

    const { url, transaction } = await ctx.services.oidc.begin(returnTo);

    setCookie(c, TRANSACTION_COOKIE, sealTransaction(transaction, ctx.config.sessionSecret), {
      path: "/api/auth",
      httpOnly: true,
      secure: ctx.config.cookieSecure,
      // Lax, not Strict: the provider redirects the browser back here from
      // another origin, and Strict would withhold the cookie exactly then.
      sameSite: "Lax",
      maxAge: 15 * 60,
    });

    return c.redirect(url);
  });

  /**
   * Where the provider sends the browser back.
   *
   * A browser is following a redirect here, not making an XHR, so a failure
   * must not be a JSON error envelope — that would put a wall of braces on the
   * screen. Everything that can go wrong goes back to the sign-in page with a
   * message the person can act on.
   */
  app.get("/callback", async (c) => {
    const ctx = c.get("ctx");
    const logger = c.get("logger");

    const refuse = (message: string) =>
      c.redirect(`/admin/login?error=${encodeURIComponent(message)}`);

    const sealed = getCookie(c, TRANSACTION_COOKIE);
    deleteCookie(c, TRANSACTION_COOKIE, { path: "/api/auth" });

    const transaction = sealed ? openTransaction(sealed, ctx.config.sessionSecret) : null;
    if (!transaction) {
      // Expired, tampered with, or a callback nobody asked for.
      return refuse("That sign-in attempt expired or was not started here. Please try again.");
    }

    let claims: OidcClaims;
    try {
      claims = await ctx.services.oidc.complete(new URL(c.req.url), transaction);
    } catch (error) {
      return refuse(
        error instanceof ApiError ? error.message : "Sign-in could not be completed.",
      );
    }

    const userId = resolveUser(ctx, claims);

    /**
     * Authentication succeeded; authorization is a separate question.
     *
     * A provider may vouch for an entire company. Membership is what says this
     * particular person may edit this particular site, and its absence is the
     * expected answer for everybody who has not been invited — so it is a
     * plain message, not an error.
     */
    if (!ctx.repositories.memberships.find(ctx.siteId, userId)) {
      logger.warn("Authenticated user has no membership", { email: claims.email });
      return refuse(
        `You are signed in as ${claims.email}, but that address has no access to ` +
          "this site. Ask an administrator to add you.",
      );
    }

    establishSession(c, userId);
    logger.info("Signed in", { userId, issuer: claims.issuer });

    return c.redirect(transaction.returnTo);
  });

  app.post("/logout", async (c) => {
    const ctx = c.get("ctx");
    ctx.services.sessions.destroy(getCookie(c, SESSION_COOKIE));

    deleteCookie(c, SESSION_COOKIE, ctx.services.sessions.clearedCookieOptions());
    deleteCookie(c, CSRF_COOKIE, ctx.services.sessions.clearedCookieOptions());

    // Offered, not followed: ending the provider's session is the provider's
    // decision to make, and the SPA sends the browser there if it is there.
    const endSession = ctx.config.authDisabled ? null : await ctx.services.oidc.endSessionUrl();

    return c.json({ ok: true, endSession });
  });

  app.get("/me", requireAuth(), (c) => {
    const session = c.get("session");
    const user = c.get("user");

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        // The role is the membership's, not the user's: the same person can be
        // an administrator on one site and an editor on another.
        role: c.get("membership").role,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
      },
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    });
  });

  return app;
}
