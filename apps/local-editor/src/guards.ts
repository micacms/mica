/**
 * The Host allowlist — what replaced the local session's cookie.
 *
 * Under DNS rebinding, a page re-resolves its own name to `127.0.0.1` and the
 * browser then treats requests to it as same-origin. Writes still fail on the
 * Origin check; *reads* would succeed, and the only thing that used to stop
 * them was a session cookie scoped to `localhost` that the rebound name never
 * received. The cookie is gone — local mode keeps no session, no token and no
 * database — so the rule is stated directly instead: this server answers only
 * to names that are this machine.
 *
 * Smaller than what it replaces, standard for exactly this, and applied in
 * front of everything, /health included.
 */

import type { MiddlewareHandler } from "hono";

import type { Env } from "@micacms/runtime";

const ALLOWED = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** The hostname part of a Host header, brackets kept for IPv6. */
function hostnameOf(header: string): string {
  if (header.startsWith("[")) {
    const end = header.indexOf("]");
    return end < 0 ? header : header.slice(0, end + 1);
  }
  return header.split(":")[0] ?? "";
}

export function hostGuard(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const host = c.req.header("host") ?? "";

    if (!ALLOWED.has(hostnameOf(host).toLowerCase())) {
      return c.text(
        "This is a local Mica editor. It answers only to this machine —\n" +
          `"${host}" is not it.\n\n` +
          "To let other people edit, deploy @micacms/self-hosted with an identity\n" +
          "provider: https://github.com/micacms/mica/blob/main/docs/self-hosting.md\n",
        403,
      );
    }

    await next();
  };
}
