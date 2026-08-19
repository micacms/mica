/**
 * Authentication routes.
 *
 * The authorization code flow, and nothing else. There is no login form here,
 * no password check and no reset: the browser is sent to an identity provider,
 * comes back with a code, and Mica exchanges it for a statement about who the
 * person is.
 *
 * What Mica still decides is whether that person may edit *this site*. A valid
 * token from a correctly configured provider proves an identity and nothing
 * more; `services/admission.ts` is the gate, and an unknown person hits it.
 *
 * In local mode there is no provider, no authentication and nobody to be.
 * Serving the admin page starts a session with no identity in it (see
 * `routes/admin-spa.ts`), so nobody meets a sign-in screen on their own
 * machine, and the config layer refuses that mode anywhere it could be reached
 * by someone else.
 */

import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { ApiError } from "../lib/errors.js";
import { clientIp, type Env } from "../http.js";
import { requireAccess } from "../middleware/index.js";
import type { SessionIdentity } from "../repositories/sessions.js";
import {
  CSRF_COOKIE,
  establishSession,
  SESSION_COOKIE,
  startLocalSession,
} from "../services/session.js";
import {
  openTransaction,
  sealTransaction,
  TRANSACTION_COOKIE,
  type OidcClaims,
} from "../services/oidc.js";

/** Only ever a path on this server, so the callback cannot be an open redirect. */
function safeReturnTo(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/admin/";
  return raw;
}

const identityOf = (claims: OidcClaims): SessionIdentity => ({
  issuer: claims.issuer,
  subject: claims.subject,
  email: claims.email,
  emailVerified: claims.emailVerified,
  name: claims.name,
  groups: claims.groups,
});

export function authRoutes(): Hono<Env> {
  const app = new Hono<Env>();

  /**
   * What the sign-in screen needs to know before it draws anything.
   *
   * Public: it reveals only whether this deployment authenticates and which
   * provider it uses, which the redirect would reveal a moment later anyway.
   */
  app.get("/config", (c) => {
    const { config } = c.get("ctx");
    return c.json({
      authRequired: !config.authDisabled,
      provider: config.MICA_OIDC_ISSUER
        ? new URL(config.MICA_OIDC_ISSUER).hostname
        : null,
    });
  });

  /** Starts the flow. A redirect, not a form post. */
  app.get("/login", async (c) => {
    const ctx = c.get("ctx");
    const returnTo = safeReturnTo(c.req.query("returnTo"));

    /**
     * Nothing to sign in to, and nobody to sign in as.
     *
     * The session still has to start somewhere, because the CSRF token lives
     * on it. Serving the admin page is the usual place — but the page is
     * served by Vite during development, and by nothing at all for a bookmark
     * that lands here first, so this stays the second door.
     */
    if (ctx.config.authDisabled) {
      startLocalSession(c);
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

    const identity = identityOf(claims);

    /**
     * Authentication succeeded; admission is a separate question.
     *
     * A provider may vouch for an entire company. The admission rules are what
     * say this particular person may edit this particular site, and their
     * refusal is the expected answer for everybody who was not meant to be
     * here — so it is a plain message, not an error.
     */
    const verdict = ctx.services.admission.admits(identity);
    if (!verdict.admitted) {
      logger.warn("Authenticated but not admitted", {
        subject: identity.subject,
        reason: verdict.reason,
      });
      return refuse(
        `You are signed in as ${claims.email}, but that account has no access to ` +
          "this site. Ask whoever runs it to add you.",
      );
    }

    establishSession(c, identity);
    logger.info("Signed in", { subject: identity.subject, issuer: identity.issuer });

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

  /**
   * The session this request is in, and who it belongs to.
   *
   * `identity` is null in local mode, where there is nobody. The SPA reads
   * that as "draw no account chrome", which is the whole of what local mode
   * has to say about users.
   */
  app.get("/me", requireAccess(), (c) => {
    const { identity, session } = c.get("access");

    return c.json({
      identity: identity && {
        subject: identity.subject,
        email: identity.email,
        name: identity.name,
      },
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    });
  });

  return app;
}
