/**
 * Agents over MCP, when `MICA_MCP` is on: Mica's own authorization server, and
 * `/mcp` behind its bearer gate. Off, neither route exists.
 */

import { createAgentAuthorization, type OidcAuth } from "@micacms/auth-oidc";
import { MCP_PATH, mcpRoutes } from "@micacms/mcp";
import type { Env, Logger, RuntimeContext } from "@micacms/runtime";
import type { Hono } from "hono";

import type { SelfHostedConfig } from "./config.js";

export function agentRoutes(config: SelfHostedConfig, ctx: RuntimeContext, auth: OidcAuth, logger: Logger): Hono<Env>[] {
  if (!config.MICA_MCP) return [];
  const agents = createAgentAuthorization({
    config,
    sessions: auth.sessions,
    admission: auth.admission,
    logger,
    resource: new URL(MCP_PATH, config.MICA_PUBLIC_URL),
    publish: config.MICA_MCP_PUBLISH,
  });
  return [agents.routes, mcpRoutes(ctx, { gate: agents.gate, publish: config.MICA_MCP_PUBLISH, localFiles: false })];
}
