/**
 * The Host allowlist.
 *
 * Under DNS rebinding, a page re-resolves its own name to `127.0.0.1` and the
 * browser then treats requests to it as same-origin. Writes still fail on the
 * Origin check; *reads* would succeed. Local mode keeps no session or token,
 * so this server answers only to names that are this machine. It applies in
 * front of everything, the health endpoints included.
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
          "provider: https://mica.build/docs/self-hosting/\n",
        403,
      );
    }

    await next();
  };
}
