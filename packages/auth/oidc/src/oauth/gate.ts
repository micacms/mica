/**
 * The gate in front of `/mcp`: a bearer token that this Mica issued, for this
 * resource, of a person whom the rules still admit. A request without one gets
 * the challenge that tells an agent where to get one (RFC 9728).
 */

import type { Env } from "@micacms/runtime";
import type { Context, MiddlewareHandler } from "hono";

import type { AdmissionPolicy } from "../admission.js";
import { resourceMetadataUrl } from "./routes.js";
import { grantedScopes, offeredScopes } from "./scopes.js";
import type { Tokens } from "./tokens.js";

export interface AgentGateDeps {
  tokens: Tokens;
  admission: AdmissionPolicy;
  resource: URL;
  publish: boolean;
}

export function agentGate(deps: AgentGateDeps): MiddlewareHandler<Env> {
  const metadata = resourceMetadataUrl(deps.resource);
  const scope = grantedScopes(undefined, offeredScopes(deps.publish)).join(" ");

  /** 401 with the challenge. Without a token, no error code (RFC 6750, section 3.1). */
  const challenge = (c: Context<Env>, error?: { code: string; description: string }) => {
    const params = [
      ...(error ? [`error="${error.code}"`, `error_description="${error.description}"`] : []),
      `resource_metadata="${metadata}"`,
      `scope="${scope}"`,
    ];
    return c.json(
      { error: error?.code ?? "invalid_token", error_description: error?.description ?? "Sign in to use Mica's tools." },
      401,
      { "www-authenticate": `Bearer ${params.join(", ")}` },
    );
  };

  return async (c, next) => {
    const token = /^Bearer +([A-Za-z0-9._~+/=-]+)$/i.exec(c.req.header("authorization") ?? "")?.[1];
    if (!token) return challenge(c);

    const opened = deps.tokens.open("access", token);
    if (!opened || opened.value.resource !== deps.resource.href) {
      return challenge(c, { code: "invalid_token", description: "The token is not valid, or it has expired." });
    }

    const grant = opened.value;
    const verdict = deps.admission.admits(grant.identity);
    if (!verdict.admitted) {
      c.get("logger").warn("Agent of a person no longer admitted", { subject: grant.identity.subject, reason: verdict.reason });
      return c.json({ error: "access_denied", error_description: "You no longer have access to this site." }, 403);
    }

    c.set("access", { identity: { subject: grant.identity.subject, email: grant.identity.email, name: grant.identity.name } });
    c.set("grant", {
      token,
      clientId: grant.clientId,
      clientName: grant.clientName,
      scopes: grant.scopes,
      expiresAt: Math.floor(opened.expiresAt / 1000),
      resource: grant.resource,
      resourceMetadataUrl: metadata,
    });
    await next();
  };
}
