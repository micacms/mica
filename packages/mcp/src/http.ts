/**
 * `/mcp` over Streamable HTTP. Each request is answered by a new server, as the
 * protocol is stateless. The composing app puts its gate in front: none in the
 * loopback local editor, the OAuth bearer gate in the image.
 */

import type { AccessContext } from "@micacms/core/internal";
import { allowedOrigins, ApiError, rateLimit, type Env, type RuntimeContext } from "@micacms/runtime";
import { createMcpHandler, type AuthInfo } from "@modelcontextprotocol/server";
import { Hono, type Context, type MiddlewareHandler } from "hono";

import { createMcpServer, type Caller, type McpOptions } from "./server.js";

export const MCP_PATH = "/mcp";

export interface McpRoutesOptions extends McpOptions {
  /** Middleware in front of the tools. It sets `access` and `grant`, or refuses the request. */
  gate?: MiddlewareHandler<Env>[];
}

/** A page on another site must not reach the tools. An agent sends no Origin at all. */
function originCheck(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const origin = c.req.header("origin");
    if (origin !== undefined) {
      const parsed = URL.canParse(origin) ? new URL(origin).origin : null;
      if (!parsed || !allowedOrigins(c.get("ctx").config).includes(parsed)) {
        throw new ApiError("forbidden", "Request origin is not allowed.");
      }
    }
    await next();
  };
}

/** The verified grant, in the shape the SDK checks scopes on. Absent without a gate. */
function authInfoOf(c: Context<Env>): AuthInfo | undefined {
  const grant = c.get("grant");
  if (!grant) return undefined;
  return {
    token: grant.token,
    clientId: grant.clientId,
    scopes: grant.scopes,
    expiresAt: grant.expiresAt,
    resource: new URL(grant.resource),
    resourceMetadataUrl: grant.resourceMetadataUrl,
    extra: { clientName: grant.clientName, identity: c.get("access")?.identity ?? null },
  };
}

function callerOf(authInfo: AuthInfo | undefined): Caller {
  const extra = authInfo?.extra as { clientName?: string; identity?: AccessContext["identity"] } | undefined;
  return { identity: extra?.identity ?? null, ...(extra?.clientName ? { clientName: extra.clientName } : {}) };
}

export function mcpRoutes(ctx: RuntimeContext, options: McpRoutesOptions): Hono<Env> {
  const handler = createMcpHandler((request) => createMcpServer(ctx, options, callerOf(request.authInfo)), {
    // An upload arrives as base64 in the JSON body: a third larger than the file.
    maxRequestBodySize: Math.ceil((ctx.config.MICA_MAX_UPLOAD_BYTES * 4) / 3) + 1024 * 1024,
    onerror: (error) => ctx.logger.debug("MCP request refused", { message: error.message }),
  });

  const app = new Hono<Env>();
  app.use(MCP_PATH, rateLimit());
  app.use(MCP_PATH, originCheck());
  for (const middleware of options.gate ?? []) app.use(MCP_PATH, middleware);
  app.all(MCP_PATH, (c) => {
    const authInfo = authInfoOf(c);
    return handler.fetch(c.req.raw, authInfo ? { authInfo } : {});
  });
  return app;
}
