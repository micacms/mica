/**
 * The product boundary: `npx @micacms/editor` installs no authentication code, keeps no state,
 * and answers only to this machine. A helper shared between the two apps must fail the build here.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { collection, defineSite, slug, text } from "@micacms/core/internal";
import { contentFiles, createApp, createLogger, createRuntimeContext } from "@micacms/runtime";

import { loadConfig } from "../src/config.js";
import { hostGuard } from "../src/guards.js";

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * Never reachable from the local editor: auth code, and the self-hosted app
 * with its clone, credential and sync code.
 */
const FORBIDDEN = new Set(["openid-client", "jose", "@micacms/auth-oidc", "@micacms/self-hosted"]);

const WORKSPACE_DIRS: Record<string, string> = {
  "@micacms/core": "packages/core",
  "@micacms/runtime": "packages/runtime",
  "@micacms/mcp": "packages/mcp",
  "@micacms/editor-ui": "packages/editor-ui",
  "@micacms/editor": "apps/local-editor",
};

interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function manifestOf(name: string): Manifest {
  const dir = WORKSPACE_DIRS[name];
  assert.ok(dir, `unexpected workspace dependency "${name}" — add it to this test's map`);
  return JSON.parse(
    readFileSync(path.join(WORKSPACE_ROOT, dir, "package.json"), "utf8"),
  ) as Manifest;
}

describe("the dependency graph", () => {
  it("has no path from @micacms/editor to any auth package", () => {
    const seen = new Set<string>();
    const queue = ["@micacms/editor"];

    while (queue.length > 0) {
      const name = queue.shift()!;
      if (seen.has(name)) continue;
      seen.add(name);

      const manifest = manifestOf(name);
      const dependencies = Object.keys({
        ...manifest.dependencies,
        // Optional and peer count too: a package manager still fetches them.
        ...manifest.peerDependencies,
        ...manifest.optionalDependencies,
      });

      for (const dependency of dependencies) {
        assert.ok(
          !FORBIDDEN.has(dependency),
          `${name} depends on ${dependency}, which the local editor must never install`,
        );
        if (dependency.startsWith("@micacms/")) queue.push(dependency);
      }
    }

    // A rename must not silently turn this test into a walk over nothing.
    assert.ok(seen.has("@micacms/runtime"));
  });

  it("imports no auth module from its own sources", () => {
    for (const name of readdirSync(path.join(WORKSPACE_ROOT, "apps/local-editor/src"))) {
      if (!name.endsWith(".ts")) continue;
      const source = readFileSync(
        path.join(WORKSPACE_ROOT, "apps/local-editor/src", name),
        "utf8",
      );
      for (const forbidden of FORBIDDEN) {
        assert.ok(!source.includes(`"${forbidden}"`), `${name} imports ${forbidden}`);
      }
    }
  });
});

const model = defineSite({
  collections: {
    notes: collection({
      label: "Notes",
      fields: { title: text({ label: "Title", required: true }), slug: slug({ from: "title" }) },
    }),
  },
});

describe("the running composition", () => {
  let contentRoot: string;
  let app: ReturnType<typeof createApp>;

  const request = (path: string, init: RequestInit = {}) =>
    app.request(`http://localhost:6422${path}`, init);

  before(() => {
    contentRoot = mkdtempSync(path.join(tmpdir(), "mica-boundary-"));

    // Composed the way src/index.ts composes it.
    const ctx = createRuntimeContext({
      config: loadConfig({ MICA_LOG_LEVEL: "silent", MICA_CONTENT_ROOT: contentRoot }),
      model,
      files: contentFiles({ root: contentRoot }),
      logger: createLogger({ level: "silent", pretty: false }),
      operational: () => ({ auth: "none" }),
    });

    app = createApp(ctx, { guards: [hostGuard()] });
  });

  after(() => rmSync(contentRoot, { recursive: true, force: true }));

  it("refuses any Host that is not this machine", async () => {
    for (const host of ["evil.example", "evil.example:6422", "192.168.1.20:6422"]) {
      const response = await request("/health", { headers: { host } });
      assert.equal(response.status, 403, host);

      const body = await response.text();
      assert.match(body, /self-hosted/);
    }
  });

  it("answers the names that are this machine", async () => {
    for (const host of ["localhost:6422", "127.0.0.1:6422", "[::1]:6422", "localhost"]) {
      const response = await request("/health", { headers: { host } });
      assert.equal(response.status, 200, host);
    }
  });

  it("serves the unauthenticated surface: no sign-in, and no login route", async () => {
    const config = await request("/api/auth/config", { headers: { host: "localhost" } });
    assert.deepEqual(await config.json(), { authRequired: false, provider: null });

    // There is no login to have: the route itself is absent, not disabled.
    const login = await request("/api/auth/login", { headers: { host: "localhost" } });
    assert.equal(login.status, 404);
  });

  it("admits every request without a cookie, because there is nobody to be", async () => {
    const response = await request("/api/admin/schema", { headers: { host: "localhost" } });
    assert.equal(response.status, 200);
  });

  it("writes into the content directory, and nowhere else", async () => {
    const saved = await request("/api/admin/collections/notes/entries", {
      method: "POST",
      headers: {
        host: "localhost",
        origin: "http://localhost:6422",
        "content-type": "application/json",
      },
      body: JSON.stringify({ data: { title: "Boundary" } }),
    });
    assert.equal(saved.status, 201);

    const written = readdirSync(path.join(contentRoot, "notes"));
    assert.deepEqual(written, ["boundary"]);
  });
});

describe("the browser bundle", () => {
  const dist = path.join(WORKSPACE_ROOT, "packages/editor-ui/dist");

  it("contains no OIDC client code", (t) => {
    let assets: string[];
    try {
      assets = (readdirSync(dist, { recursive: true }) as string[]).filter((name) =>
        name.endsWith(".js"),
      );
    } catch {
      // CI builds the packages before it tests, so there this check always runs.
      t.skip("editor-ui/dist is not built");
      return;
    }

    assert.ok(assets.length > 0, "a built bundle should have JS assets");

    for (const asset of assets) {
      const source = readFileSync(path.join(dist, asset), "utf8");
      for (const marker of ["openid-client", "well-known/openid-configuration", "id_token"]) {
        assert.ok(!source.includes(marker), `${asset} contains "${marker}"`);
      }
    }
  });
});
