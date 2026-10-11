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
 * more; `admission.ts` is the gate, and an unknown person hits it.
 */

import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { ApiError, clientIp, type Env, type RateLimiter } from "@micacms/runtime";

import type { AdmissionPolicy } from "./admission.js";
import type { AuthConfig } from "./config.js";
import { requireAccess, sessionOf, type GateDeps } from "./gate.js";
import { safeReturnTo } from "./return-to.js";
import {
  establishSession,
  type SessionIdentity,
  type SessionService,
} from "./session.js";
import {
  openTransaction,
  sealTransaction,
  type OidcClaims,
  type OidcService,
} from "./oidc.js";

const identityOf = (claims: OidcClaims): SessionIdentity => ({
  issuer: claims.issuer,
  subject: claims.subject,
  email: claims.email,
  emailVerified: claims.emailVerified,
  name: claims.name,
  groups: claims.groups,
});

export interface AuthRoutesDeps {
  config: AuthConfig;
  sessions: SessionService;
  oidc: OidcService;
  admission: AdmissionPolicy;
  loginLimiter: RateLimiter;
}

export function authRoutes(deps: AuthRoutesDeps): Hono<Env> {
  const app = new Hono<Env>();
  const { config, sessions, oidc, admission } = deps;
  const gate: GateDeps = deps;

  /**
   * What the sign-in screen needs to know before it draws anything.
   *
   * Public: it reveals only that this deployment authenticates and which
   * provider it uses, which the redirect would reveal a moment later anyway.
   */
  app.get("/config", (c) =>
    c.json({
      authRequired: true,
      provider: config.MICA_OIDC_ISSUER ? new URL(config.MICA_OIDC_ISSUER).hostname : null,
    }),
  );

  /** Starts the flow. A redirect, not a form post. */
  app.get("/login", async (c) => {
    const returnTo = safeReturnTo(c.req.query("returnTo"), config.MICA_PUBLIC_URL);

    // Rate limited on the way out as well as the way back: starting a flow is
    // cheap for a client and costs Mica a discovery request.
    const limit = deps.loginLimiter.check(`oidc:${clientIp(c)}`);
    if (!limit.allowed) {
      throw new ApiError(
        "rate_limited",
        `Too many sign-in attempts. Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.`,
        { headers: { "retry-after": String(limit.retryAfter) } },
      );
    }

    const { url, transaction } = await oidc.begin(returnTo);

    setCookie(c, sessions.names.transaction, sealTransaction(transaction, config.sessionSecret), {
      path: "/api/auth",
      httpOnly: true,
      secure: config.cookieSecure,
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
    const logger = c.get("logger");

    const refuse = (message: string) =>
      c.redirect(`/admin/login?error=${encodeURIComponent(message)}`);

    const sealed = getCookie(c, sessions.names.transaction);
    deleteCookie(c, sessions.names.transaction, { path: "/api/auth", secure: config.cookieSecure });

    const transaction = sealed ? openTransaction(sealed, config.sessionSecret) : null;
    if (!transaction) {
      // Expired, tampered with, or a callback nobody asked for.
      return refuse("That sign-in attempt expired or was not started here. Please try again.");
    }

    let claims: OidcClaims;
    try {
      claims = await oidc.complete(new URL(c.req.url), transaction);
    } catch (error) {
      return refuse(error instanceof ApiError ? error.message : "Sign-in could not be completed.");
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
    const verdict = admission.admits(identity);
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

    try {
      establishSession(c, sessions, identity);
    } catch (error) {
      logger.error("Could not start a session", { subject: identity.subject, error });
      return refuse("Sign-in could not be completed: your account details are too large.");
    }
    logger.info("Signed in", { subject: identity.subject, issuer: identity.issuer });

    return c.redirect(transaction.returnTo);
  });

  // There is no server-side session to end; clearing the cookies is sign-out.
  app.post("/logout", async (c) => {
    deleteCookie(c, sessions.names.session, sessions.clearedCookieOptions());
    deleteCookie(c, sessions.names.csrf, sessions.clearedCookieOptions());

    // Offered, not followed: ending the provider's session is the provider's
    // decision to make, and the SPA sends the browser there if it is there.
    return c.json({ ok: true, endSession: await oidc.endSessionUrl() });
  });

  /** The session this request is in, and who it belongs to. */
  app.get("/me", requireAccess(gate), (c) => {
    const session = sessionOf(c);
    const { identity } = c.get("access");

    return c.json({
      identity,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    });
  });

  return app;
}
