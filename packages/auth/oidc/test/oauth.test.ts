/**
 * Mica as the authorization server of its own MCP endpoint: discovery, the
 * consent page, the code exchange with PKCE, refresh, and the bearer gate. The
 * identity provider is not involved: the session cookie is made directly, as a
 * sign-in would make it.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { collection, defineSite, slug, text } from "@micacms/core/internal";
import { contentFiles, createApp, createLogger, createRuntimeContext, type Env, type OwnerPolicy } from "@micacms/runtime";
import { Hono } from "hono";

import { createAgentAuthorization, createSessionService, type AdmissionPolicy, type AuthConfig, type SessionIdentity, type SessionService } from "../dist/index.js";
import { checkRedirectUri, isPublicAddress } from "../dist/oauth/index.js";
import { fetchJson } from "../dist/oauth/clients.js";

const ISSUER = "https://cms.example.com";
const RESOURCE = new URL(`${ISSUER}/mcp`);
const CLIENT_ID = "https://agent.example/oauth/client.json";
const REDIRECT = "http://127.0.0.1/callback";

const config = {
  MICA_PUBLIC_URL: ISSUER,
  sessionSecret: "s".repeat(48),
  cookieSecure: true,
  admitGroups: [],
  MICA_SESSION_TTL_HOURS: 8,
  MICA_SESSION_IDLE_HOURS: 4,
} as unknown as AuthConfig;

const ada: SessionIdentity = {
  issuer: "https://id.example.test",
  subject: "ada",
  email: "ada@example.com",
  emailVerified: true,
  name: "Ada",
  groups: [],
};

/** Admits Ada while `open` is true. */
const rules = { open: true };
const admission: AdmissionPolicy = {
  summary: "test",
  admits: (identity) => (rules.open && identity.subject === "ada" ? { admitted: true } : { admitted: false, reason: "not admitted" }),
};

const documents: Record<string, unknown> = {
  [CLIENT_ID]: { client_id: CLIENT_ID, client_name: "Agent One", redirect_uris: [REDIRECT] },
};

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** These tests check the gate in front of `/mcp`, and never publish. */
const noPublish: OwnerPolicy = {
  owner: "managed",
  publishAvailability: () => ({ enabled: false, reason: "These tests do not publish." }),
  prepare: async () => {},
  commitAuthor: (editor) => editor,
  push: async () => {
    throw new Error("These tests do not publish.");
  },
};

interface Setup {
  request(path: string, init?: RequestInit & { session?: string }): Promise<Response>;
  sessions: SessionService;
  close(): void;
}

function setup(options: { publish?: boolean; sessions?: SessionService; resource?: URL } = {}): Setup {
  const root = mkdtempSync(join(tmpdir(), "mica-oauth-test-"));
  const site = defineSite({ collections: { posts: collection({ label: "Posts", fields: { title: text(), slug: slug({ from: "title" }) } }) } });
  const ctx = createRuntimeContext({
    config: {
      MICA_LOG_LEVEL: "silent",
      HOST: "127.0.0.1",
      PORT: 6422,
      MICA_PUBLIC_URL: ISSUER,
      MICA_CONTENT_ROOT: root,
      MICA_MAX_UPLOAD_BYTES: 1024,
      MICA_TRUST_PROXY: false,
      MICA_MCP_PUBLISH: false,
      isLoopback: false,
      contentRoot: root,
      adminOrigins: [],
    },
    model: site,
    files: contentFiles({ root }),
    logger: createLogger({ level: "silent", pretty: false }),
    policy: noPublish,
  });
  const sessions = options.sessions ?? createSessionService(config);
  const agents = createAgentAuthorization({
    config,
    sessions,
    admission,
    logger: ctx.logger,
    resource: options.resource ?? RESOURCE,
    publish: options.publish ?? false,
    fetchDocument: async (url) => {
      if (!(url.href in documents)) throw new Error("404");
      return documents[url.href];
    },
  });
  // What the tools would see: the grant that the gate set.
  const mcp = new Hono<Env>();
  for (const middleware of agents.gate) mcp.use("/mcp", middleware);
  mcp.post("/mcp", (c) => c.json({ grant: c.get("grant"), access: c.get("access") }));
  const app = createApp(ctx, { routes: [agents.routes, mcp] });

  return {
    sessions,
    async request(path, init = {}) {
      const headers = new Headers(init.headers);
      if (init.session) headers.set("cookie", `${sessions.names.session}=${init.session}`);
      return app.request(`${ISSUER}${path}`, { ...init, headers });
    },
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

function authorizeQuery(params: Record<string, string>): string {
  return `/oauth/authorize?${new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: "http://127.0.0.1:3118/callback",
    code_challenge_method: "S256",
    state: "st-1",
    resource: RESOURCE.href,
    ...params,
  })}`;
}

/** The hidden form fields of the consent page. */
function formOf(html: string): { request: string; csrf: string } {
  const field = (name: string) => new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1] ?? "";
  return { request: field("request"), csrf: field("csrf") };
}

/** Consent, allow, and the code at the redirect. */
async function allow(s: Setup, session: string, challenge: string, extra: Record<string, string> = {}): Promise<URL> {
  const page = await s.request(authorizeQuery({ code_challenge: challenge, ...extra }), { session });
  assert.equal(page.status, 200);
  const { request, csrf } = formOf(await page.text());
  const answer = await s.request("/oauth/authorize", {
    method: "POST",
    session,
    headers: { origin: ISSUER, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ request, csrf, decision: "allow" }),
  });
  assert.equal(answer.status, 303);
  return new URL(answer.headers.get("location")!);
}

function exchange(s: Setup, fields: Record<string, string>): Promise<Response> {
  return s.request("/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
}

describe("discovery", () => {
  let s: Setup;
  before(() => {
    s = setup();
  });
  after(() => s.close());

  it("answers an unauthenticated agent with where to find the authorization server", async () => {
    const response = await s.request("/mcp", { method: "POST" });
    assert.equal(response.status, 401);
    const challenge = response.headers.get("www-authenticate")!;
    assert.match(challenge, /resource_metadata="https:\/\/cms\.example\.com\/\.well-known\/oauth-protected-resource\/mcp"/);
    assert.match(challenge, /scope="content:read content:write"/);
    assert.doesNotMatch(challenge, /error=/);
  });

  it("names Mica as the authorization server of /mcp", async () => {
    const metadata = (await (await s.request("/.well-known/oauth-protected-resource/mcp")).json()) as Record<string, unknown>;
    assert.equal(metadata["resource"], RESOURCE.href);
    assert.deepEqual(metadata["authorization_servers"], [ISSUER]);
  });

  it("supports metadata documents, PKCE and the iss parameter", async () => {
    const metadata = (await (await s.request("/.well-known/oauth-authorization-server")).json()) as Record<string, unknown>;
    assert.equal(metadata["issuer"], ISSUER);
    assert.equal(metadata["client_id_metadata_document_supported"], true);
    assert.equal(metadata["authorization_response_iss_parameter_supported"], true);
    assert.deepEqual(metadata["code_challenge_methods_supported"], ["S256"]);
    assert.deepEqual(metadata["scopes_supported"], ["content:read", "content:write"]);
  });
});

describe("the authorization code flow", () => {
  let s: Setup;
  let session: string;
  before(() => {
    s = setup();
    session = s.sessions.create(ada).cookie;
  });
  after(() => s.close());

  it("sends a person without a session to sign in, and back", async () => {
    const response = await s.request(authorizeQuery({ code_challenge: pkce().challenge }));
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("location")!, ISSUER);
    assert.equal(location.pathname, "/api/auth/login");
    assert.match(location.searchParams.get("returnTo")!, /^\/oauth\/authorize\?/);
  });

  it("shows the client, the person and what it can do", async () => {
    const response = await s.request(authorizeQuery({ code_challenge: pkce().challenge }), { session });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
    const html = await response.text();
    assert.match(html, /Allow Agent One to edit cms\.example\.com\?/);
    assert.match(html, /ada@example\.com/);
    assert.match(html, /agent\.example/);
    assert.doesNotMatch(html, /Publish drafts/);
  });

  it("exchanges the code once, with the right verifier, for tokens that open /mcp", async () => {
    const { verifier, challenge } = pkce();
    const back = await allow(s, session, challenge);
    assert.equal(back.origin + back.pathname, "http://127.0.0.1:3118/callback");
    assert.equal(back.searchParams.get("state"), "st-1");
    assert.equal(back.searchParams.get("iss"), ISSUER);
    const code = back.searchParams.get("code")!;

    const wrong = await exchange(s, { grant_type: "authorization_code", code, client_id: CLIENT_ID, code_verifier: pkce().verifier });
    assert.equal(wrong.status, 400);

    const response = await exchange(s, {
      grant_type: "authorization_code",
      code,
      client_id: CLIENT_ID,
      code_verifier: verifier,
      redirect_uri: "http://127.0.0.1:3118/callback",
      resource: RESOURCE.href,
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const tokens = (await response.json()) as { access_token: string; refresh_token: string; scope: string; expires_in: number };
    assert.equal(tokens.scope, "content:read content:write");
    assert.ok(tokens.expires_in <= 3600);

    const again = await exchange(s, { grant_type: "authorization_code", code, client_id: CLIENT_ID, code_verifier: verifier });
    assert.equal(((await again.json()) as { error: string }).error, "invalid_grant");

    const mcp = await s.request("/mcp", { method: "POST", headers: { authorization: `Bearer ${tokens.access_token}` } });
    assert.equal(mcp.status, 200);
    const seen = (await mcp.json()) as { grant: { scopes: string[]; clientName: string }; access: { identity: { email: string } } };
    assert.deepEqual(seen.grant.scopes, ["content:read", "content:write"]);
    assert.equal(seen.grant.clientName, "Agent One");
    assert.equal(seen.access.identity.email, "ada@example.com");

    const refreshed = await exchange(s, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: CLIENT_ID });
    assert.equal(refreshed.status, 200);

    const wider = await exchange(s, { grant_type: "refresh_token", refresh_token: tokens.refresh_token, scope: "content:publish" });
    assert.equal(((await wider.json()) as { error: string }).error, "invalid_scope");
  });

  it("refuses the tokens of a person whom the rules no longer admit", async () => {
    const { verifier, challenge } = pkce();
    const code = (await allow(s, session, challenge)).searchParams.get("code")!;
    const tokens = (await (await exchange(s, { grant_type: "authorization_code", code, client_id: CLIENT_ID, code_verifier: verifier })).json()) as {
      access_token: string;
      refresh_token: string;
    };
    rules.open = false;
    try {
      const mcp = await s.request("/mcp", { method: "POST", headers: { authorization: `Bearer ${tokens.access_token}` } });
      assert.equal(mcp.status, 403);
      const refreshed = await exchange(s, { grant_type: "refresh_token", refresh_token: tokens.refresh_token });
      assert.equal(refreshed.status, 400);
    } finally {
      rules.open = true;
    }
  });

  it("sends a refusal back to the client", async () => {
    const page = await s.request(authorizeQuery({ code_challenge: pkce().challenge }), { session });
    const { request, csrf } = formOf(await page.text());
    const answer = await s.request("/oauth/authorize", {
      method: "POST",
      session,
      headers: { origin: ISSUER, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ request, csrf, decision: "deny" }),
    });
    const back = new URL(answer.headers.get("location")!);
    assert.equal(back.searchParams.get("error"), "access_denied");
    assert.equal(back.searchParams.get("iss"), ISSUER);
  });

  it("refuses a consent without the session's CSRF token, or from another site", async () => {
    const page = await s.request(authorizeQuery({ code_challenge: pkce().challenge }), { session });
    const { request, csrf } = formOf(await page.text());
    const post = (fields: Record<string, string>, origin: string) =>
      s.request("/oauth/authorize", {
        method: "POST",
        session,
        headers: { origin, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields),
      });
    assert.equal((await post({ request, csrf: "forged", decision: "allow" }, ISSUER)).status, 403);
    assert.equal((await post({ request, csrf, decision: "allow" }, "https://evil.example")).status, 403);
    assert.equal((await post({ request, csrf, decision: "allow" }, "null")).status, 403);
  });

  it("never redirects to an address that the client did not register", async () => {
    const response = await s.request(authorizeQuery({ code_challenge: pkce().challenge, redirect_uri: "https://evil.example/cb" }), { session });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("location"), null);
  });

  it("shows a request without PKCE as an error on Mica's page, not at the client", async () => {
    const response = await s.request(authorizeQuery({ code_challenge: "short" }), { session });
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("location"), null);
  });

  it("is no open redirect: a registered address gets nothing before the consent", async () => {
    const registered = (await (
      await s.request("/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: ["https://evil.example/login"] }),
      })
    ).json()) as { client_id: string };
    const query = `/oauth/authorize?client_id=${encodeURIComponent(registered.client_id)}`;
    const anonymous = await s.request(query);
    assert.match(anonymous.headers.get("location")!, /^\/api\/auth\/login\?/);
    const signedIn = await s.request(query, { session });
    assert.equal(signedIn.status, 400);
    assert.equal(signedIn.headers.get("location"), null);
  });

  it("keeps the Origin of the consent form: the page sets no referrer policy that would make it null", async () => {
    const response = await s.request(authorizeQuery({ code_challenge: pkce().challenge }), { session });
    assert.doesNotMatch(await response.text(), /no-referrer/);
  });

  it("refuses an unknown client on the page", async () => {
    const response = await s.request(authorizeQuery({ client_id: "https://unknown.example/c.json", code_challenge: pkce().challenge }), { session });
    assert.equal(response.status, 400);
  });

  it("refuses a token for another resource", async () => {
    const other = setup({ resource: new URL(`${ISSUER}/other`) });
    try {
      const { verifier, challenge } = pkce();
      const code = (await allow(other, other.sessions.create(ada).cookie, challenge, { resource: `${ISSUER}/other` })).searchParams.get("code")!;
      const tokens = (await (await exchange(other, { grant_type: "authorization_code", code, client_id: CLIENT_ID, code_verifier: verifier })).json()) as {
        access_token: string;
      };
      const mcp = await s.request("/mcp", { method: "POST", headers: { authorization: `Bearer ${tokens.access_token}` } });
      assert.equal(mcp.status, 401);
      assert.match(mcp.headers.get("www-authenticate")!, /error="invalid_token"/);
    } finally {
      other.close();
    }
  });
});

describe("a sign-in that is not recent", () => {
  it("is renewed before the consent, so that the grant gets new claims", async () => {
    const sessions = createSessionService(config);
    const record = sessions.resolve(sessions.create(ada).cookie)!;
    const old = { ...record, createdAt: new Date(Date.now() - 10 * 60_000).toISOString() };
    const s = setup({ sessions: { ...sessions, resolve: () => old } });
    try {
      const response = await s.request(authorizeQuery({ code_challenge: pkce().challenge }), { session: "any" });
      assert.equal(response.status, 302);
      assert.match(response.headers.get("location")!, /^\/api\/auth\/login\?/);
    } finally {
      s.close();
    }
  });
});

describe("publish", () => {
  it("is offered and shown only when the operator allows it", async () => {
    const s = setup({ publish: true });
    try {
      const metadata = (await (await s.request("/.well-known/oauth-authorization-server")).json()) as { scopes_supported: string[] };
      assert.ok(metadata.scopes_supported.includes("content:publish"));
      const page = await s.request(authorizeQuery({ code_challenge: pkce().challenge, scope: "content:read content:write content:publish" }), {
        session: s.sessions.create(ada).cookie,
      });
      assert.match(await page.text(), /Publish drafts/);
    } finally {
      s.close();
    }
  });
});

describe("registration", () => {
  let s: Setup;
  before(() => {
    s = setup();
  });
  after(() => s.close());

  it("registers a client without storing it, and says on the page that its name is not confirmed", async () => {
    const response = await s.request("/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Old Agent", redirect_uris: ["http://localhost:4000/cb"] }),
    });
    assert.equal(response.status, 201);
    const client = (await response.json()) as { client_id: string };
    assert.match(client.client_id, /^mica-client\./);

    const page = await s.request(
      authorizeQuery({ client_id: client.client_id, redirect_uri: "http://localhost:4000/cb", code_challenge: pkce().challenge }),
      { session: s.sessions.create(ada).cookie },
    );
    const html = await page.text();
    assert.match(html, /Old Agent/);
    assert.match(html, /registered itself/);
  });

  it("refuses a redirect URI that could leak a code", async () => {
    for (const uri of ["http://evil.example/cb", "javascript:alert(1)", "https://ok.example/cb#frag"]) {
      const response = await s.request("/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: [uri] }),
      });
      assert.equal(response.status, 400, uri);
    }
  });
});

describe("addresses", () => {
  it("accepts https, loopback http and a native app's scheme", () => {
    for (const uri of ["https://app.example/cb", "http://127.0.0.1:3000/cb", "http://localhost/cb", "cursor://anysphere.cursor-retrieval/oauth/callback"]) {
      assert.equal(checkRedirectUri(uri), null, uri);
    }
  });

  it("does not fetch a client document from a private network", () => {
    for (const address of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "192.168.1.1", "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1"]) {
      assert.equal(isPublicAddress(address), false, address);
    }
    for (const address of ["8.8.8.8", "2001:4860:4860::8888"]) assert.equal(isPublicAddress(address), true, address);
  });

  it("refuses a name that resolves to this machine when it connects", async () => {
    await assert.rejects(fetchJson(new URL("https://localhost:9/client.json")), /not a public address/);
    await assert.rejects(fetchJson(new URL("https://10.0.0.1/client.json")), /not a public address/);
    await assert.rejects(fetchJson(new URL("https://[::1]/client.json")), /not a public address/);
  });
});
