/**
 * Mica as a small OAuth 2.1 authorization server for agents, as the MCP
 * specification (2026-07-28) describes it, hosted beside the MCP server.
 *
 * Mica still authenticates nobody. A person signs in at the identity provider
 * with the editor's own flow, the admission rules decide as for the editor, and
 * the person allows one agent on a consent page. Mica then issues sealed
 * tokens, and stores nothing: no clients, no codes, no tokens.
 *
 *   /.well-known/oauth-protected-resource/mcp   where an agent finds this server
 *   /.well-known/oauth-authorization-server     what this server supports
 *   /oauth/authorize                            the consent page
 *   /oauth/token                                code and refresh token → access token
 *   /oauth/register                             registration, for older clients
 */

import { createHash } from "node:crypto";

import { rateLimit, type Env, type Logger } from "@micacms/runtime";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import { cors } from "hono/cors";

import type { AdmissionPolicy } from "../admission.js";
import type { AuthConfig } from "../config.js";
import { safeEqual, type SessionRecord, type SessionService } from "../session.js";
import { ClientError, matchRedirectUri, type Clients } from "./clients.js";
import { consentPage, errorPage } from "./pages.js";
import { grantedScopes, offeredScopes } from "./scopes.js";
import { createUsedCodes, type Grant, type Tokens } from "./tokens.js";

/** The consent needs a sign-in this recent, so that the grant gets the claims and the time of a new one. */
const FRESH_SIGN_IN_MS = 5 * 60_000;

const PKCE = /^[A-Za-z0-9._~-]{43,128}$/;

export interface AgentRoutesDeps {
  config: Pick<AuthConfig, "MICA_PUBLIC_URL" | "MICA_SESSION_TTL_HOURS">;
  sessions: SessionService;
  admission: AdmissionPolicy;
  logger: Logger;
  tokens: Tokens;
  clients: Clients;
  /** The MCP endpoint: the resource every token is for. */
  resource: URL;
  publish: boolean;
}

/** Where the Protected Resource Metadata of `resource` is (RFC 9728): the path goes after the well-known name. */
export function resourceMetadataUrl(resource: URL): string {
  return `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname === "/" ? "" : resource.pathname}`;
}

/** The same resource, written with or without a trailing slash. */
const sameResource = (a: string, b: string): boolean => a.replace(/\/$/, "") === b.replace(/\/$/, "");

export function agentRoutes(deps: AgentRoutesDeps): Hono<Env> {
  const { config, sessions, admission, tokens, clients, resource } = deps;
  const issuer = config.MICA_PUBLIC_URL;
  const offered = offeredScopes(deps.publish);
  const usedCodes = createUsedCodes();
  const app = new Hono<Env>();

  // Public documents and endpoints that a client in a browser may call. No cookie is involved.
  app.use("/.well-known/oauth-*", cors({ origin: "*" }));
  app.use("/oauth/token", cors({ origin: "*" }));
  app.use("/oauth/register", cors({ origin: "*" }));
  app.use("/oauth/*", rateLimit());
  app.use("/oauth/*", bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "invalid_request", error_description: "The request is too large." }, 413) }));

  const protectedResource = () => ({
    resource: resource.href,
    authorization_servers: [issuer],
    scopes_supported: offered,
    bearer_methods_supported: ["header"],
    resource_name: "Mica",
  });
  app.get(`/.well-known/oauth-protected-resource${resource.pathname}`, (c) => c.json(protectedResource()));
  app.get("/.well-known/oauth-protected-resource", (c) => c.json(protectedResource()));

  app.get("/.well-known/oauth-authorization-server", (c) =>
    c.json({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: offered,
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    }),
  );

  /* -------------------------------------------------------------- *
   * Registration
   * -------------------------------------------------------------- */

  app.post("/oauth/register", async (c) => {
    const metadata = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!metadata || typeof metadata !== "object") {
      return c.json({ error: "invalid_client_metadata", error_description: "Send the client metadata as JSON." }, 400);
    }
    try {
      const client = clients.register(metadata);
      return c.json(
        {
          client_id: client.id,
          client_id_issued_at: Math.floor(Date.now() / 1000),
          client_name: client.name,
          redirect_uris: client.redirectUris,
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        },
        201,
        { "cache-control": "no-store" },
      );
    } catch (error) {
      if (!(error instanceof ClientError)) throw error;
      return c.json({ error: "invalid_redirect_uri", error_description: error.message }, 400);
    }
  });

  /* -------------------------------------------------------------- *
   * Consent
   * -------------------------------------------------------------- */

  const html = (c: Context<Env>, view: { html: string; csp: string }, status: 200 | 400 | 403 = 200) =>
    c.html(view.html, status, { "content-security-policy": view.csp, "cache-control": "no-store" });

  /** The authorization response (RFC 9207: with `iss`), at the client's redirect URI. */
  const back = (redirectUri: string, params: Record<string, string | null>): string => {
    const url = new URL(redirectUri);
    for (const [name, value] of Object.entries(params)) if (value !== null) url.searchParams.set(name, value);
    url.searchParams.set("iss", issuer);
    return url.href;
  };

  /** The live session, if the person behind it is still admitted. */
  const sessionOf = (c: Context<Env>): SessionRecord | "not-admitted" | null => {
    const session = sessions.resolve(getCookie(c, sessions.names.session));
    if (!session) return null;
    return admission.admits(session.identity).admitted ? session : "not-admitted";
  };

  app.get("/oauth/authorize", async (c) => {
    const query = c.req.query();
    const clientId = query["client_id"] ?? "";

    // The person first: Mica fetches a client's document only for somebody who may edit.
    const session = sessionOf(c);
    if (session === "not-admitted") return html(c, errorPage("You do not have access to this site."), 403);
    if (!session || Date.now() - Date.parse(session.createdAt) > FRESH_SIGN_IN_MS) {
      const here = new URL(c.req.url);
      return c.redirect(`/api/auth/login?returnTo=${encodeURIComponent(`${here.pathname}${here.search}`)}`);
    }

    // Every error before the consent stays on this page. Anybody can register a redirect URI,
    // so an automatic redirect there would be an open redirect (RFC 9700, section 4.11.2).
    let client;
    try {
      client = await clients.resolve(clientId);
    } catch (error) {
      if (!(error instanceof ClientError)) throw error;
      deps.logger.warn("Agent client refused", { clientId: clientId.slice(0, 200), reason: error.message });
      return html(c, errorPage(error.message), 400);
    }
    const requested = query["redirect_uri"] ?? (client.redirectUris.length === 1 ? client.redirectUris[0]! : "");
    const redirectUri = matchRedirectUri(client, requested);
    if (!redirectUri) return html(c, errorPage(`${client.name} asked to return to an address that it did not register.`), 400);

    const state = query["state"] ?? null;
    const refuse = (message: string) => html(c, errorPage(`${client.name} sent a request that Mica cannot accept: ${message}`), 400);
    if (query["response_type"] !== "code") return refuse("only the authorization code flow is supported.");
    if (query["code_challenge_method"] !== "S256" || !PKCE.test(query["code_challenge"] ?? "")) return refuse("PKCE with S256 is required.");
    if (query["resource"] !== undefined && !sameResource(query["resource"], resource.href)) {
      return refuse(`Mica issues tokens only for ${resource.href}.`);
    }

    const scopes = grantedScopes(query["scope"], offered);
    const { token } = tokens.issue("authorize", {
      clientId: client.id,
      clientName: client.name,
      verified: client.verified,
      redirectUri,
      codeChallenge: query["code_challenge"]!,
      state,
      scopes,
      resource: resource.href,
    });

    return html(
      c,
      consentPage({
        site: new URL(issuer).host,
        email: session.identity.email,
        clientName: client.name,
        clientHost: client.verified ? new URL(client.id).host : null,
        verified: client.verified,
        redirectUri,
        scopes,
        endsAt: new Date(Date.parse(session.createdAt) + config.MICA_SESSION_TTL_HOURS * 3600_000),
        request: token,
        csrf: session.csrfToken,
        action: "/oauth/authorize",
      }),
    );
  });

  app.post("/oauth/authorize", async (c) => {
    // A form on another site must not allow an agent for the person.
    const origin = c.req.header("origin");
    if (origin !== undefined && origin !== issuer) return html(c, errorPage("This request did not come from Mica's own page."), 403);

    const form = await c.req.parseBody();
    const session = sessionOf(c);
    if (session === "not-admitted") return html(c, errorPage("You do not have access to this site."), 403);
    if (!session || typeof form["csrf"] !== "string" || !safeEqual(form["csrf"], session.csrfToken)) {
      return html(c, errorPage("Your session has ended. Start again from the app."), 403);
    }
    const opened = typeof form["request"] === "string" ? tokens.open("authorize", form["request"]) : null;
    if (!opened) return html(c, errorPage("This page has expired. Start again from the app."), 400);
    const request = opened.value;

    if (form["decision"] !== "allow") {
      return c.redirect(back(request.redirectUri, { error: "access_denied", error_description: "The person did not allow access.", state: request.state }), 303);
    }

    const grant: Grant = {
      clientId: request.clientId,
      clientName: request.clientName,
      scopes: request.scopes,
      resource: request.resource,
      identity: session.identity,
      endsAt: Date.parse(session.createdAt) + config.MICA_SESSION_TTL_HOURS * 3600_000,
    };
    const { token: code } = tokens.issue("code", { ...grant, redirectUri: request.redirectUri, codeChallenge: request.codeChallenge });
    deps.logger.info("Allowed an agent", {
      subject: session.identity.subject,
      client: request.clientName,
      clientId: request.clientId.slice(0, 200),
      scopes: request.scopes.join(" "),
    });
    return c.redirect(back(request.redirectUri, { code, state: request.state }), 303);
  });

  /* -------------------------------------------------------------- *
   * Tokens
   * -------------------------------------------------------------- */

  const tokenError = (c: Context<Env>, error: string, description: string, status: 400 | 401 = 400) =>
    c.json({ error, error_description: description }, status, { "cache-control": "no-store", pragma: "no-cache" });

  const issueFor = (c: Context<Env>, grant: Grant) => {
    const now = Date.now();
    const access = tokens.issue("access", grant, now);
    const refresh = tokens.issue("refresh", grant, now);
    return c.json(
      {
        access_token: access.token,
        token_type: "Bearer",
        expires_in: Math.max(1, Math.floor((access.expiresAt - now) / 1000)),
        refresh_token: refresh.token,
        scope: grant.scopes.join(" "),
      },
      200,
      { "cache-control": "no-store", pragma: "no-cache" },
    );
  };

  /** A grant whose person the rules no longer admit gives no new token. */
  const stillAdmitted = (grant: Grant): boolean => admission.admits(grant.identity).admitted;

  app.post("/oauth/token", async (c) => {
    const form = await c.req.parseBody();
    const field = (name: string): string | undefined => (typeof form[name] === "string" ? (form[name] as string) : undefined);
    const clientId = field("client_id");

    if (field("grant_type") === "authorization_code") {
      const opened = tokens.open("code", field("code") ?? "");
      if (!opened) return tokenError(c, "invalid_grant", "The code is not valid, or it has expired.");
      const { redirectUri, codeChallenge, ...grant } = opened.value;
      if (clientId !== grant.clientId) return tokenError(c, "invalid_grant", "The code was issued to another client.");
      if (field("redirect_uri") !== undefined && field("redirect_uri") !== redirectUri) {
        return tokenError(c, "invalid_grant", "The redirect_uri is not the one of the authorization request.");
      }
      const verifier = field("code_verifier") ?? "";
      if (!PKCE.test(verifier) || !safeEqual(createHash("sha256").update(verifier).digest("base64url"), codeChallenge)) {
        return tokenError(c, "invalid_grant", "The code_verifier does not match.");
      }
      if (field("resource") !== undefined && !sameResource(field("resource")!, grant.resource)) {
        return tokenError(c, "invalid_target", "The code is for another resource.");
      }
      if (!usedCodes.claim(opened.id, opened.expiresAt)) return tokenError(c, "invalid_grant", "The code was used already.");
      if (!stillAdmitted(grant)) return tokenError(c, "invalid_grant", "The person no longer has access to this site.");
      return issueFor(c, grant);
    }

    if (field("grant_type") === "refresh_token") {
      const opened = tokens.open("refresh", field("refresh_token") ?? "");
      if (!opened) return tokenError(c, "invalid_grant", "The refresh token is not valid, or the access has ended. Allow the app again.");
      const grant = opened.value;
      if (clientId !== undefined && clientId !== grant.clientId) return tokenError(c, "invalid_grant", "The token was issued to another client.");
      if (!stillAdmitted(grant)) return tokenError(c, "invalid_grant", "The person no longer has access to this site.");
      const narrower = field("scope")?.split(/\s+/).filter(Boolean);
      if (narrower && narrower.some((scope) => !grant.scopes.includes(scope))) {
        return tokenError(c, "invalid_scope", "A refresh cannot add a scope.");
      }
      return issueFor(c, narrower && narrower.length > 0 ? { ...grant, scopes: narrower } : grant);
    }

    return tokenError(c, "unsupported_grant_type", "Use authorization_code or refresh_token.");
  });

  return app;
}
