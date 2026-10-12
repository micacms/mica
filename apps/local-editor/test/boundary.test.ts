/**
 * The product boundary, as tests.
 *
 * `npx @micacms/editor` must install no authentication code, keep no state,
 * and answer only to this machine. Rules like these erode the first time
 * somebody shares a convenient helper between the two apps — so they fail
 * the build here instead of eroding.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { collection, defineSite, slug, text } from "@micacms/core";
import { contentFiles, createApp, createLogger, createRuntimeContext } from "@micacms/runtime";

import { loadConfig } from "../src/config.js";
import { hostGuard } from "../src/guards.js";

/* ------------------------------------------------------------------ *
 * The dependency graph
 * ------------------------------------------------------------------ */

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * What must never be reachable from the local editor: auth code, and the
 * self-hosted app with its clone, credential and sync code.
 */
const FORBIDDEN = new Set(["openid-client", "jose", "@micacms/auth-oidc", "@micacms/self-hosted"]);

/** Where a workspace package's manifest lives, by name. */
const WORKSPACE_DIRS: Record<string, string> = {
  "@micacms/core": "packages/core",
  "@micacms/runtime": "packages/runtime",
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

    // The walk actually reached the runtime — a rename must not silently turn
    // this test into a walk over nothing.
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

/* ------------------------------------------------------------------ *
 * The running composition
 * ------------------------------------------------------------------ */

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

    // Composed the way src/index.ts composes it, database-lessness included.
    const ctx = createRuntimeContext({
      config: loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent", CONTENT_ROOT: contentRoot }),
      model,
      files: contentFiles({ root: contentRoot }),
      logger: createLogger({ level: "silent", pretty: false }),
      operational: () => ({ auth: "none", database: null }),
    });

    app = createApp(ctx, { guards: [hostGuard()] });
  });

  after(() => rmSync(contentRoot, { recursive: true, force: true }));

  it("refuses any Host that is not this machine", async () => {
    for (const host of ["evil.example", "evil.example:6422", "192.168.1.20:6422"]) {
      const response = await request("/health", { headers: { host } });
      assert.equal(response.status, 403, host);

      const body = await response.text();
      // A clear error directing remote users to the self-hosted shape.
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

    // The save is a file in the tree…
    const written = readdirSync(path.join(contentRoot, "notes"));
    assert.deepEqual(written, ["boundary.json"]);

    // …and no database appeared beside it. There is no DATA_DIR to check
    // because the configuration has no such concept; the content directory is
    // the only place this process writes.
    const everything = readdirSync(contentRoot, { recursive: true }) as string[];
    assert.ok(
      everything.every((entry) => !entry.includes("sqlite")),
      `unexpected database file: ${everything.join(", ")}`,
    );
  });
});

/* ------------------------------------------------------------------ *
 * The built browser bundle
 * ------------------------------------------------------------------ */

describe("the browser bundle", () => {
  const dist = path.join(WORKSPACE_ROOT, "packages/editor-ui/dist");

  it("contains no OIDC client code", (t) => {
    let assets: string[];
    try {
      assets = (readdirSync(dist, { recursive: true }) as string[]).filter((name) =>
        name.endsWith(".js"),
      );
    } catch {
      // The UI has not been built in this checkout. CI builds packages before
      // it tests, so there this check always runs.
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
