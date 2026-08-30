/**
 * The gate: what stands between a request and the admin API.
 *
 * Two layers, in order. `requireAccess` turns a session cookie into an
 * `AccessContext` — or a 401 — re-checking admission on every request so a
 * configuration change is immediate. `csrfProtection` is the double-submit
 * token over the Origin check the runtime already applies: cross-origin
 * JavaScript can neither read the cookie nor set the header.
 */

import { getCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";

import { ApiError, type Env } from "@micacms/runtime";

import type { AdmissionPolicy } from "./admission.js";
import { CSRF_COOKIE, CSRF_HEADER, safeEqual, SESSION_COOKIE, type SessionService } from "./session.js";
import type { SessionRecord, SessionRepository } from "./sessions-repository.js";

/**
 * The session behind the current request. Auth's own context variable —
 * the runtime knows only the `access` it derives from it.
 */
const SESSION_VARIABLE = "authSession";

export function sessionOf(c: Context<Env>): SessionRecord {
  // Set by requireAccess, which runs in front of everything that calls this.
  return c.get(SESSION_VARIABLE as never) as SessionRecord;
}

export interface GateDeps {
  sessions: SessionService;
  sessionsRepo: SessionRepository;
  admission: AdmissionPolicy;
}

/**
 * Rejects the request unless there is a live session whose person is still
 * admitted.
 *
 * Admission is re-read on every request, not decided once at sign-in. That is
 * what makes a configuration change immediate: an operator who takes somebody
 * out of `MICA_ADMIT_SUBJECTS` and restarts has removed them. What it cannot
 * make immediate is a group removal at the provider — the claims here are the
 * ones the provider sent, and Mica learns better at the next sign-in.
 */
export function requireAccess(deps: GateDeps): MiddlewareHandler<Env> {
  return async (c, next) => {
    const session = deps.sessions.resolve(getCookie(c, SESSION_COOKIE));

    if (!session) {
      throw new ApiError("unauthenticated", "Your session has expired. Please sign in again.");
    }

    const { identity } = session;
    if (!identity) {
      // A row from a pre-split local-mode run of the same database. It
      // authenticates nobody, so it is not a session for an authenticated
      // deployment.
      deps.sessionsRepo.delete(session.id);
      throw new ApiError("unauthenticated", "Please sign in again.");
    }

    const verdict = deps.admission.admits(identity);
    if (!verdict.admitted) {
      c.get("logger").warn("Session no longer admitted", {
        subject: identity.subject,
        reason: verdict.reason,
      });
      throw new ApiError("forbidden", "You no longer have access to this site.");
    }

    c.set(SESSION_VARIABLE as never, session as never);
    c.set("access", {
      identity: { subject: identity.subject, email: identity.email, name: identity.name },
    });
    await next();
  };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Second CSRF layer: double-submit token. The session's token is issued in a
 * cookie the SPA can read and must be echoed in a header.
 *
 * Runs after `requireAccess`, and complements the session cookie's
 * `SameSite=Lax`, which already blocks the classic cross-site form post.
 */
export function csrfProtection(): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) {
      await next();
      return;
    }

    const session = sessionOf(c);
    const header = c.req.header(CSRF_HEADER);
    const cookie = getCookie(c, CSRF_COOKIE);

    if (!header || !cookie || !safeEqual(header, cookie) || !safeEqual(header, session.csrfToken)) {
      throw new ApiError("forbidden", "Invalid or missing CSRF token. Reload the page and retry.");
    }

    await next();
  };
}
