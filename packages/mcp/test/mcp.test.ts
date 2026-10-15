import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { collection, defineSite, media, richText, singleton, slug, text } from "@micacms/core/internal";
import { contentFiles, createApp, createLogger, createRuntimeContext, type Env, type RuntimeContext } from "@micacms/runtime";
import type { MiddlewareHandler } from "hono";

import { mcpRoutes, SCOPES, type McpRoutesOptions } from "../src/index.js";

const ORIGIN = "http://localhost:6422";
const VERSION = "2026-07-28";

/** A real 1×1 PNG. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const site = defineSite({
  collections: {
    posts: collection({
      label: "Posts",
      fields: {
        title: text({ label: "Title", required: true, maxLength: 20 }),
        slug: slug({ from: "title" }),
        body: richText(),
        cover: media({ accept: "image" }),
      },
    }),
  },
  singletons: {
    settings: singleton({ label: "Website", fields: { siteName: text() } }),
  },
});

interface Harness {
  ctx: RuntimeContext;
  root: string;
  rpc(method: string, params?: Record<string, unknown>, headers?: Record<string, string>): Promise<Response>;
  /** A tool's result: its JSON, or its error text. */
  call(name: string, args?: Record<string, unknown>): Promise<{ error: boolean; value: any }>;
  close(): void;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function harness(options: Partial<McpRoutesOptions> = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), "mica-mcp-test-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  writeFileSync(join(root, "README.md"), "test\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");

  const ctx = createRuntimeContext({
    config: {
      MICA_LOG_LEVEL: "silent",
      HOST: "127.0.0.1",
      PORT: 6422,
      MICA_PUBLIC_URL: ORIGIN,
      MICA_CONTENT_ROOT: root,
      MICA_LOCAL_PUBLISH: true,
      MICA_MAX_UPLOAD_BYTES: 1024 * 1024,
      MICA_TRUST_PROXY: false,
      MICA_MCP_PUBLISH: false,
      isLoopback: true,
      contentRoot: root,
      adminOrigins: [],
    },
    model: site,
    files: contentFiles({ root }),
    logger: createLogger({ level: "silent", pretty: false }),
  });
  const app = createApp(ctx, { routes: [mcpRoutes(ctx, { publish: false, localFiles: false, ...options })] });

  let id = 0;
  const rpc: Harness["rpc"] = async (method, params = {}, headers = {}) =>
    app.request(`${ORIGIN}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": VERSION,
        "mcp-method": method,
        ...(typeof params["name"] === "string" ? { "mcp-name": params["name"] } : {}),
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++id,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": VERSION,
            "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });

  return {
    ctx,
    root,
    rpc,
    async call(name, args = {}) {
      const response = await rpc("tools/call", { name, arguments: args });
      assert.equal(response.status, 200, await response.clone().text());
      const body = (await response.json()) as { result: { isError?: boolean; content: Array<{ text: string }> } };
      const text = body.result.content[0]!.text;
      const error = body.result.isError === true;
      return { error, value: error ? text : JSON.parse(text) };
    },
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

async function toolNames(h: Harness): Promise<string[]> {
  const body = (await (await h.rpc("tools/list")).json()) as { result: { tools: Array<{ name: string }> } };
  return body.result.tools.map((tool) => tool.name);
}

describe("the MCP tools", () => {
  let h: Harness;
  before(() => {
    h = harness();
  });
  after(() => h.close());

  it("offers no publish unless it is allowed", async () => {
    const names = await toolNames(h);
    assert.ok(names.includes("save_entry"));
    assert.ok(!names.includes("publish"));
  });

  it("describes the model with the value formats", async () => {
    const { value } = await h.call("describe_model");
    assert.deepEqual(Object.keys(value.collections), ["posts"]);
    assert.equal(value.collections.posts.fields.title.kind, "text");
    assert.match(value.valueFormats.richText, /Markdoc/);
  });

  it("creates, reads and replaces an entry with its revision", async () => {
    const created = await h.call("save_entry", { collection: "posts", data: { title: "Hello", body: "Some *text*." } });
    assert.equal(created.error, false);
    assert.equal(created.value.slug, "hello");

    const read = await h.call("get_entry", { collection: "posts", slug: "hello" });
    assert.equal(read.value.data.body.trim(), "Some *text*.");
    assert.equal(read.value.revision, created.value.revision);

    const saved = await h.call("save_entry", {
      collection: "posts",
      slug: "hello",
      revision: read.value.revision,
      data: { ...read.value.data, title: "Hello again" },
    });
    assert.equal(saved.error, false);

    const listed = await h.call("list_entries", { collection: "posts" });
    assert.deepEqual(listed.value.entries, [{ slug: "hello", title: "Hello again" }]);
  });

  it("refuses a save over a newer revision, and says what to do", async () => {
    const stale = await h.call("save_entry", { collection: "posts", slug: "hello", revision: "0000", data: { title: "Late" } });
    assert.equal(stale.error, true);
    assert.match(stale.value, /Read it again/);
  });

  it("refuses an update without a revision", async () => {
    const result = await h.call("save_entry", { collection: "posts", slug: "hello", data: { title: "Blind" } });
    assert.equal(result.error, true);
    assert.match(result.value, /revision/);
  });

  it("returns the field issues of invalid data", async () => {
    const result = await h.call("save_entry", { collection: "posts", data: { title: "x".repeat(30) } });
    assert.equal(result.error, true);
    assert.match(result.value, /"issues"/);
  });

  it("uploads base64 into an entry's media folder", async () => {
    const result = await h.call("upload_media", { name: "Cover.png", directory: "posts/hello/media", content: PNG, accept: "image" });
    assert.equal(result.error, false, result.value);
    assert.equal(result.value.path, "posts/hello/media/cover.png");
    assert.equal(result.value.width, 1);
  });

  it("does not read a file on this machine for a remote agent", async () => {
    const result = await h.call("upload_media", { name: "x.png", file: "/etc/hosts" });
    assert.equal(result.error, true);
    assert.match(result.value, /base64/);
  });

  it("lists the drafts with their revisions, and discards them", async () => {
    const before = await h.call("get_changes");
    const paths = Object.fromEntries(
      (before.value.changes as Array<{ path: string; revision?: string | null }>).map((change) => [change.path, change.revision ?? null]),
    );
    assert.ok(Object.keys(paths).includes("posts/hello/index.json"));

    const discarded = await h.call("discard_changes", { paths });
    assert.equal(discarded.error, false, discarded.value);
    const after = await h.call("get_changes");
    assert.deepEqual(after.value.changes, []);
  });

  it("saves a singleton", async () => {
    const read = await h.call("get_singleton", { name: "settings" });
    const saved = await h.call("save_singleton", { name: "settings", data: { siteName: "Mica" }, revision: read.value.revision });
    assert.equal(saved.error, false, saved.value);
  });

  it("refuses a page on another site", async () => {
    const response = await h.rpc("tools/list", {}, { origin: "https://evil.example" });
    assert.equal(response.status, 403);
  });
});

describe("local files and publish", () => {
  let h: Harness;
  before(() => {
    h = harness({ publish: true, localFiles: true });
  });
  after(() => h.close());

  it("offers publish when it is allowed", async () => {
    assert.ok((await toolNames(h)).includes("publish"));
  });

  it("reads a file on this machine for a local agent", async () => {
    const file = join(h.root, "outside.png");
    writeFileSync(file, Buffer.from(PNG, "base64"));
    const result = await h.call("upload_media", { name: "photo.png", file });
    assert.equal(result.error, false, result.value);
    assert.equal(result.value.path, "media/photo.png");
  });

  it("publishes the reviewed drafts as one commit", async () => {
    await h.call("save_entry", { collection: "posts", data: { title: "First" } });
    const changes = await h.call("get_changes");
    const paths = Object.fromEntries(
      (changes.value.changes as Array<{ path: string; revision?: string | null }>).map((change) => [change.path, change.revision ?? null]),
    );
    const published = await h.call("publish", { message: "Add the first post", paths });
    assert.equal(published.error, false, published.value);
    assert.equal(git(h.root, "log", "-1", "--format=%s"), "Add the first post");
  });
});

describe("scopes", () => {
  /** A gate that grants only these scopes, as the OAuth gate does after verifying a token. */
  const grant = (scopes: string[]): MiddlewareHandler<Env> => async (c, next) => {
    c.set("access", { identity: { subject: "s1", email: "ada@example.com", name: "Ada" } });
    c.set("grant", {
      token: "t",
      clientId: "https://client.example/meta.json",
      clientName: "Test agent",
      scopes,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      resource: `${ORIGIN}/mcp`,
      resourceMetadataUrl: `${ORIGIN}/.well-known/oauth-protected-resource/mcp`,
    });
    await next();
  };

  it("answers a write without its scope with a scope challenge", async () => {
    const h = harness({ gate: [grant([SCOPES.read])] });
    try {
      const response = await h.rpc("tools/call", { name: "save_entry", arguments: { collection: "posts", data: { title: "No" } } });
      assert.equal(response.status, 403);
      const challenge = response.headers.get("www-authenticate") ?? "";
      assert.match(challenge, /insufficient_scope/);
      // The scopes it has, too: a client that asks for exactly these keeps read.
      assert.match(challenge, /scope="content:read content:write"/);
      assert.match(challenge, /resource_metadata=/);

      const read = await h.call("describe_model");
      assert.equal(read.error, false);
    } finally {
      h.close();
    }
  });

  it("writes with the write scope", async () => {
    const h = harness({ gate: [grant([SCOPES.read, SCOPES.write])] });
    try {
      const saved = await h.call("save_entry", { collection: "posts", data: { title: "Yes" } });
      assert.equal(saved.error, false, saved.value);
    } finally {
      h.close();
    }
  });
});
