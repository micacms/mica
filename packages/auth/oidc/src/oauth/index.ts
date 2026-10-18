/**
 * Access for agents: Mica as the authorization server of its own MCP endpoint.
 * Only the self-hosted app composes it, and only when `MICA_MCP` is on.
 */

import type { Env, Logger } from "@micacms/runtime";
import type { Hono, MiddlewareHandler } from "hono";

import type { AdmissionPolicy } from "../admission.js";
import type { AuthConfig } from "../config.js";
import type { SessionService } from "../session.js";
import { createClients } from "./clients.js";
import { agentGate } from "./gate.js";
import { agentRoutes } from "./routes.js";
import { createTokens } from "./tokens.js";

export interface AgentAuthorizationDeps {
  config: AuthConfig;
  sessions: SessionService;
  admission: AdmissionPolicy;
  logger: Logger;
  /** The MCP endpoint, such as https://cms.example.com/mcp. */
  resource: URL;
  /** Whether agents can be allowed to publish (`MICA_MCP_PUBLISH`). */
  publish: boolean;
  /** Replaces the https fetch of client metadata documents in tests. */
  fetchDocument?: (url: URL) => Promise<unknown>;
}

export interface AgentAuthorization {
  /** The metadata documents and `/oauth/*`, mounted at the root. */
  routes: Hono<Env>;
  /** In front of `/mcp`. */
  gate: MiddlewareHandler<Env>[];
}

export function createAgentAuthorization(deps: AgentAuthorizationDeps): AgentAuthorization {
  const tokens = createTokens(deps.config.sessionSecret);
  const clients = createClients({ secret: deps.config.sessionSecret, ...(deps.fetchDocument ? { fetchDocument: deps.fetchDocument } : {}) });
  return {
    routes: agentRoutes({ ...deps, tokens, clients }),
    gate: [agentGate({ tokens, admission: deps.admission, resource: deps.resource, publish: deps.publish })],
  };
}

export { checkRedirectUri, isPublicAddress } from "./clients.js";
export { resourceMetadataUrl } from "./routes.js";
