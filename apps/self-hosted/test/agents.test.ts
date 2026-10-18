/**
 * Agents in the image: off unless `MICA_MCP` is on, and then the whole way from
 * a registration to a tool call, through the consent page and the token.
 */

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { setTimeout as wait } from "node:timers/promises";

import { createHarness, TEST_ORIGIN, type TestHarness } from "./helpers.js";

const MODERN = "2026-07-28";

function toolsList(h: TestHarness, token?: string): Promise<Response> {
  return h.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": MODERN,
      "mcp-method": "tools/list",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": MODERN,
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}

describe("agents, by default", () => {
  let h: TestHarness;
  before(async () => {
    h = await createHarness();
  });
  after(() => h.close());

  it("have no endpoint at all", async () => {
    assert.equal((await toolsList(h)).status, 404);
    assert.equal((await h.request("/.well-known/oauth-authorization-server")).status, 404);
  });
});

describe("agents, with MICA_MCP", () => {
  let h: TestHarness;
  before(async () => {
    h = await createHarness({ MICA_MCP: "true" });
  });
  after(() => h.close());

  it("get a challenge without a token", async () => {
    const response = await toolsList(h);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate")!, /resource_metadata="http:\/\/localhost:6422\/\.well-known\/oauth-protected-resource\/mcp"/);
  });

  it("reach the tools after a person allows them", async () => {
    const registered = (await (
      await h.request("/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_name: "Agent", redirect_uris: ["http://127.0.0.1/callback"] }),
      })
    ).json()) as { client_id: string };

    const verifier = randomBytes(32).toString("base64url");
    const query = new URLSearchParams({
      response_type: "code",
      client_id: registered.client_id,
      redirect_uri: "http://127.0.0.1:5000/callback",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      state: "s",
      resource: `${TEST_ORIGIN}/mcp`,
    });
    const session = await h.signIn();
    const page = await (await h.request(`/oauth/authorize?${query}`, { session })).text();
    const field = (name: string) => new RegExp(`name="${name}" value="([^"]+)"`).exec(page)![1]!;
    // A person reads the page first: Mica refuses an Allow within a second of the page (double-clickjacking).
    await wait(1000);

    const allowed = await h.request("/oauth/authorize", {
      method: "POST",
      session,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ request: field("request"), csrf: field("csrf"), decision: "allow" }),
    });
    assert.equal(allowed.status, 303);
    const code = new URL(allowed.headers.get("location")!).searchParams.get("code")!;

    const tokens = (await (
      await h.request("/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: registered.client_id, code_verifier: verifier }),
      })
    ).json()) as { access_token: string };

    const response = await toolsList(h, tokens.access_token);
    assert.equal(response.status, 200);
    const names = ((await response.json()) as { result: { tools: Array<{ name: string }> } }).result.tools.map((tool) => tool.name);
    assert.ok(names.includes("save_entry"));
    assert.ok(!names.includes("publish"));
    assert.ok(names.includes("upload_media"));
  });
});
