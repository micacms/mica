/**
 * @micacms/auth-oidc — the server-only OIDC gate around @micacms/runtime.
 *
 * One factory: hand it the finished configuration and a logger, and it
 * returns the `AuthSurface` the runtime mounts — sign-in
 * routes at `/api/auth`, and the session-plus-CSRF gate in front of the admin
 * API — together with the services the composing app reports on.
 *
 * This package is a dependency of `@micacms/self-hosted` and of nothing else.
 * The local editor must never gain a path to it: that absence is the product
 * boundary that keeps `npx @micacms/editor` free of authentication code.
 */

import type { AuthSurface, Logger } from "@micacms/runtime";
import { createRateLimiter, type RateLimiter } from "@micacms/runtime";

import { createAdmissionPolicy, type AdmissionPolicy } from "./admission.js";
import type { AuthConfig } from "./config.js";
import { csrfProtection, requireAccess } from "./gate.js";
import { createOidcService, type OidcService } from "./oidc.js";
import { authRoutes } from "./routes.js";
import { createSessionService, type SessionService } from "./session.js";

export interface OidcAuthDeps {
  config: AuthConfig;
  logger: Logger;
}

export interface OidcAuth {
  /** What `createApp` mounts: routes at /api/auth, the gate before /api/admin. */
  surface: AuthSurface;
  sessions: SessionService;
  admission: AdmissionPolicy;
  oidc: OidcService;
  loginLimiter: RateLimiter;
}

export function createOidcAuth(deps: OidcAuthDeps): OidcAuth {
  const { config, logger } = deps;

  const sessions = createSessionService(config);
  const admission = createAdmissionPolicy(config);
  const oidc = createOidcService({ config, logger });
  const loginLimiter = createRateLimiter({
    limit: config.LOGIN_MAX_ATTEMPTS,
    windowMs: config.LOGIN_WINDOW_MS,
  });

  const gate = { sessions, admission };

  return {
    surface: {
      routes: authRoutes({ config, sessions, oidc, admission, loginLimiter }),
      gate: [requireAccess(gate), csrfProtection()],
    },
    sessions,
    admission,
    oidc,
    loginLimiter,
  };
}

export { createAdmissionPolicy, type AdmissionPolicy, type AdmissionResult } from "./admission.js";
export {
  authEnv,
  deriveAuth,
  requireAuthConfig,
  type AuthConfig,
  type AuthEnv,
} from "./config.js";
export { csrfProtection, requireAccess, sessionOf } from "./gate.js";
export { createOidcService, type OidcService } from "./oidc.js";
export {
  createSessionService,
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_COOKIE,
  type SessionIdentity,
  type SessionRecord,
  type SessionService,
} from "./session.js";
