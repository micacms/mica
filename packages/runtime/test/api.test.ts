import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { collection, coordinates, createManifest, defineSite, MANIFEST_PATH, number, object, PROTOCOL_VERSION, referenceIndexPath, referenceSet, repeater, serializeReferenceIndex, slug, text, type FieldMap } from "@micacms/core/internal";
import { Hono } from "hono";

import { clientIp, type Env } from "../src/http.js";
import { createLogger, type Logger } from "../src/lib/logger.js";
import {
  apiErrorOf,
  contentSecurityPolicy,
  MAX_JSON_BYTES,
  securityHeaders,
} from "../src/middleware/index.js";
import { healthRoutes } from "../src/routes/health.js";
import { MODEL_UNREADABLE } from "../src/services/model-guard.js";

import {
  createHarness,
  uploadPath,
  pngBytes,
  testSite,
  type TestHarness,
} from "./helpers.js";

describe("health", () => {
  let harness: TestHarness;
  before(async () => {
    harness = await createHarness();
  });
  after(() => harness.close());

  it("answers liveness with no detail", async () => {
    const response = await harness.request("/health");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });

  it("reports readiness without naming the repository — there is no database to touch", async () => {
    const response = await harness.request("/ready");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", repository: "ok" });
  });
});

describe("readiness cache", () => {
  /** The health routes over a repository that counts its calls, and a clock the test moves. */
  function probeApp(list: () => Promise<unknown>) {
    let clock = 0;
    let calls = 0;
    const app = new Hono<Env>();
    app.use("*", async (c, next) => {
      c.set("ctx", {
        health: {},
        site: { contentRepository: { list: () => (calls++, list()) } },
      } as unknown as Env["Variables"]["ctx"]);
      c.set("logger", createLogger({ level: "silent", pretty: false }));
      await next();
    });
    app.route("/", healthRoutes({ cacheMs: 30_000, now: () => clock }));
    return {
      ready: () => app.request("/ready"),
      advance: (ms: number) => (clock += ms),
      calls: () => calls,
    };
  }

  it("makes at most one repository call in each cache period", async () => {
    const health = probeApp(async () => []);

    await Promise.all(Array.from({ length: 20 }, () => health.ready()));
    health.advance(29_999);
    assert.equal((await health.ready()).status, 200);
    assert.equal(health.calls(), 1);

    health.advance(1);
    await health.ready();
    assert.equal(health.calls(), 2);
  });

  it("reports an unreachable repository as 503, and caches that too", async () => {
    const health = probeApp(async () => {
      throw new Error("provider down");
    });

    const first = await health.ready();
    assert.equal(first.status, 503);
    assert.deepEqual(await first.json(), { status: "error", repository: "unavailable" });
    assert.equal((await health.ready()).status, 503);
    assert.equal(health.calls(), 1);
  });
});

describe("security headers", () => {
  let harness: TestHarness;
  before(async () => {
    harness = await createHarness();
  });
  after(() => harness.close());

  it("sends a same-origin Content-Security-Policy on every response", async () => {
    const response = await harness.request("/health");
    const policy = response.headers.get("content-security-policy") ?? "";
    assert.equal(policy, "default-src 'self'; img-src 'self' blob: data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.match(response.headers.get("permissions-policy") ?? "", /geolocation=\(\)/);
    // HSTS only for an https public URL; the harness runs on plain HTTP.
    assert.equal(response.headers.get("strict-transport-security"), null);
  });

  const withMap = (fields: FieldMap) =>
    defineSite({ collections: { places: collection({ label: "Places", fields: { title: text(), slug: slug({ from: "title" }), ...fields } }) } });

  it("allows the OpenFreeMap host and blob workers only for a model with a map", () => {
    const policy = contentSecurityPolicy(withMap({ office: object({ fields: { at: coordinates({ map: "liberty" }) } }) }));
    assert.equal(
      policy,
      "default-src 'self'; img-src 'self' blob: data: https://tiles.openfreemap.org; connect-src 'self' https://tiles.openfreemap.org; " +
        "worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    assert.doesNotMatch(policy, /unsafe-eval/);
  });

  it("allows a frame only for the origins of the live preview, and a request to it only with a handover", () => {
    const site = withMap({});
    assert.doesNotMatch(contentSecurityPolicy(site), /frame-src/);
    assert.match(contentSecurityPolicy(site, ["http://localhost:*"]), /; frame-src http:\/\/localhost:\*; /);
    assert.doesNotMatch(contentSecurityPolicy(site, ["http://localhost:*"]), /connect-src/);
    assert.match(contentSecurityPolicy(site, ["https://preview.example.com"], true), /; connect-src 'self' https:\/\/preview\.example\.com; /);
  });

  it("allows the origin and the hosts of a custom style, from the model in use", async () => {
    const site = withMap({
      stops: repeater({ fields: { at: coordinates({ map: { style: "https://maps.example.com/style.json?key=abc", hosts: ["https://tiles.example.com"] } }) } }),
    });
    const custom = await createHarness({}, { site });
    try {
      const policy = (await custom.request("/health")).headers.get("content-security-policy") ?? "";
      assert.match(policy, /img-src 'self' blob: data: https:\/\/maps\.example\.com https:\/\/tiles\.example\.com;/);
      assert.match(policy, /connect-src 'self' https:\/\/maps\.example\.com https:\/\/tiles\.example\.com;/);
      assert.doesNotMatch(policy, /openfreemap|key=/);
    } finally {
      await custom.close();
    }
  });

  it("keeps a plain request id, and replaces any other", async () => {
    const id = (value: string) =>
      harness.request("/health", { headers: { "x-request-id": value } }).then((r) => r.headers.get("x-request-id"));

    assert.equal(await id("trace-42_A"), "trace-42_A");
    for (const bad of ["x".repeat(65), "a b", "a\u0007b", "<script>"]) {
      const answer = await id(bad);
      assert.notEqual(answer, bad);
      assert.match(answer ?? "", /^[A-Za-z0-9_-]{1,64}$/);
    }
  });

  it("keeps a stricter policy that a route sets itself", async () => {
    const app = new Hono<Env>();
    app.use("*", async (c, next) => {
      c.set("ctx", { config: { MICA_PUBLIC_URL: "http://localhost" } } as unknown as Env["Variables"]["ctx"]);
      await next();
    });
    app.use("*", securityHeaders());
    app.get("/sandboxed", (c) => c.body("x", 200, { "content-security-policy": "sandbox" }));

    const response = await app.request("/sandboxed");
    assert.equal(response.headers.get("content-security-policy"), "sandbox");
  });
});

describe("client address", () => {
  function app(trustProxy: boolean) {
    const app = new Hono<Env>();
    app.use("*", async (c, next) => {
      c.set("ctx", { config: { MICA_TRUST_PROXY: trustProxy } } as unknown as Env["Variables"]["ctx"]);
      await next();
    });
    app.get("/ip", (c) => c.text(clientIp(c)));
    return app;
  }
  const ip = async (trustProxy: boolean, forwarded: string) =>
    (await app(trustProxy).request("/ip", { headers: { "x-forwarded-for": forwarded } })).text();

  it("takes the right-most X-Forwarded-For entry, the one the proxy added", async () => {
    // The client sent "6.6.6.6"; the proxy appended the address it saw.
    assert.equal(await ip(true, "6.6.6.6, 203.0.113.7"), "203.0.113.7");
    assert.equal(await ip(true, "203.0.113.7"), "203.0.113.7");
  });

  it("ignores X-Forwarded-For without MICA_TRUST_PROXY", async () => {
    assert.notEqual(await ip(false, "203.0.113.7"), "203.0.113.7");
  });
});

describe("request size", () => {
  let harness: TestHarness;
  before(async () => {
    // Small, so that an oversized upload is cheap to build: 10 × 1 kB + 1 MiB.
    harness = await createHarness({ MICA_MAX_UPLOAD_BYTES: 1024 });
  });
  after(() => harness.close());

  it("refuses a JSON body above the limit before reading it", async () => {
    const response = await harness.request("/api/admin/collections/projects/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { title: "x".repeat(MAX_JSON_BYTES) } }),
    });
    assert.equal(response.status, 413);
  });

  it("refuses an upload above the limit", async () => {
    const big = new Uint8Array(10 * 1024 + 1024 * 1024 + 1);
    const response = await harness.request(uploadPath("big.png"), { method: "POST", body: big });
    assert.equal(response.status, 413);
  });

  it("refuses an upload above the limit that does not say its size, and keeps no part of it", async () => {
    const big = new Uint8Array(4 * 1024);
    big.set(pngBytes());
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(big);
        controller.close();
      },
    });
    const response = await harness.request(uploadPath("big.png"), { method: "POST", body, duplex: "half" } as RequestInit);
    assert.equal(response.status, 413);
    assert.deepEqual(readdirSync(join(harness.contentRoot, "media")).filter((name) => name.includes(".mica-")), []);
  });
});

describe("keeping my version at a save conflict", () => {
  it("saves over the newer version and logs who chose it", async () => {
    const lines: Array<{ message: string; fields?: Record<string, unknown> }> = [];
    const logger: Logger = {
      debug() {},
      info: (message, fields) => lines.push({ message, ...(fields ? { fields } : {}) }),
      warn() {},
      error() {},
      child: () => logger,
    };
    const harness = await createHarness({}, { logger });
    try {
      const put = (data: Record<string, unknown>, revision: string | null, keepMine?: boolean) =>
        harness.request("/api/admin/collections/projects/entries/haus", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data, revision, ...(keepMine ? { keepMine } : {}) }),
        });
      await harness.request("/api/admin/collections/projects/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: { title: "Haus" } }),
      });
      const opened = (await (await harness.request("/api/admin/collections/projects/entries/haus")).json()) as { revision: string };
      assert.equal((await put({ title: "Haus", slug: "haus", year: 2001 }, opened.revision)).status, 200);
      assert.equal((await put({ title: "Haus", slug: "haus", year: 1999 }, opened.revision)).status, 409);

      const current = (await (await harness.request("/api/admin/collections/projects/entries/haus")).json()) as { revision: string };
      assert.equal((await put({ title: "Haus", slug: "haus", year: 1999 }, current.revision, true)).status, 200);
      assert.deepEqual(lines.find((line) => line.message === "Kept own version over a newer save")?.fields, {
        entry: "projects/haus",
        editor: undefined,
      });
    } finally {
      await harness.close();
    }
  });
});

describe("content", () => {
  let harness: TestHarness;

  const create = (data: Record<string, unknown>) =>
    harness.request("/api/admin/collections/projects/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data }),
    });

  const get = async (slug: string) => {
    const response = await harness.request(
      `/api/admin/collections/projects/entries/${slug}`,
    );
    return { response, body: (await response.json()) as Record<string, any> };
  };

  const update = (slug: string, data: Record<string, unknown>, revision?: string | null) =>
    harness.request(`/api/admin/collections/projects/entries/${slug}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data, revision }),
    });

  const file = (path: string) => readFileSync(join(harness.contentRoot, path), "utf8");

  before(async () => {
    harness = await createHarness();
  });
  after(() => harness.close());

  it("exposes the model so the admin can render forms it does not know about", async () => {
    const response = await harness.request("/api/admin/schema");
    const body = (await response.json()) as {
      collections: Array<{ name: string; titleField: string; slugField: string; fields: object }>;
    };

    const projects = body.collections.find((item) => item.name === "projects")!;
    assert.equal(projects.titleField, "title");
    assert.equal(projects.slugField, "slug");
    assert.ok("gallery" in projects.fields);
  });

  it("names the reference sets, and gives the items of one from its index (#280)", async () => {
    const site = defineSite({
      collections: testSite.collections,
      singletons: testSite.singletons,
      references: { places: referenceSet({ label: "Places", file: "src/data/places.json" }) },
    });
    const other = await createHarness({}, { site });
    try {
      const schema = (await (await other.request("/api/admin/schema")).json()) as { references: unknown };
      assert.deepEqual(schema.references, [{ name: "places", label: "Places" }]);
      assert.equal((await other.request("/api/admin/references/places")).status, 404, "no index yet");

      mkdirSync(join(other.contentRoot, ".mica/references"), { recursive: true });
      writeFileSync(join(other.contentRoot, referenceIndexPath("places")), serializeReferenceIndex([{ id: "toedi", title: "Tödi" }]));
      assert.deepEqual(await (await other.request("/api/admin/references/places")).json(), { items: [{ id: "toedi", title: "Tödi" }] });
      assert.equal((await other.request("/api/admin/references/projects")).status, 404, "a collection is no reference set");
    } finally {
      other.close();
    }
  });

  it("gives no preview without a dev server", async () => {
    assert.deepEqual(await (await harness.request("/api/admin/preview")).json(), { state: "off", address: null, detail: null, handover: null });
    assert.equal(((await (await harness.request("/api/admin/schema")).json()) as { collections: Array<{ url: unknown }> }).collections[0]?.url, null);
  });

  it("gives the address of a preview on an origin of its own with a token for the browser", async () => {
    const other = await createHarness(
      {},
      { preview: { preview: async () => ({ state: "live", address: "https://preview.example.com", detail: null }), previewFrames: ["https://preview.example.com"], previewHandover: () => "token" } },
    );
    try {
      assert.deepEqual(await (await other.request("/api/admin/preview")).json(), { state: "live", address: "https://preview.example.com", detail: null, handover: "token" });
    } finally {
      other.close();
    }
  });

  it("gives no address and no token for a preview that is not live, only its state and why", async () => {
    const other = await createHarness(
      {},
      { preview: { preview: async () => ({ state: "starting", address: "https://preview.example.com", detail: "The preview is starting." }), previewHandover: () => "token" } },
    );
    try {
      assert.deepEqual(await (await other.request("/api/admin/preview")).json(), { state: "starting", address: null, detail: "The preview is starting.", handover: null });
    } finally {
      other.close();
    }
  });

  it("names the site with the model's label and MICA_SITE_URL, and with null without them", async () => {
    const schema = async (config: Record<string, string>, label?: string) => {
      const site = label === undefined ? testSite : defineSite({ label, collections: testSite.collections, singletons: testSite.singletons });
      const other = await createHarness(config, { site });
      try {
        return ((await (await other.request("/api/admin/schema")).json()) as { site: unknown }).site;
      } finally {
        other.close();
      }
    };
    assert.deepEqual(await schema({ MICA_SITE_URL: "https://harborlane.example" }, "Harbor Lane"), { label: "Harbor Lane", url: "https://harborlane.example" });
    assert.deepEqual(await schema({}), { label: null, url: null });
  });

  it("gives the page address of a collection only with a url in the model and MICA_SITE_URL", async () => {
    const site = defineSite({
      collections: { ...testSite.collections, projects: collection({ ...testSite.collections["projects"]!, url: "/work/{slug}" }) },
      singletons: testSite.singletons,
    });
    const page = async (config: Record<string, string>) => {
      const other = await createHarness(config, { site });
      try {
        const body = (await (await other.request("/api/admin/schema")).json()) as { collections: Array<{ name: string; page: string | null }> };
        return body.collections.map((item) => [item.name, item.page]);
      } finally {
        other.close();
      }
    };
    assert.deepEqual(await page({ MICA_SITE_URL: "https://example.com/blog" }), [
      ["projects", "https://example.com/blog/work/{slug}"],
      ...Object.keys(testSite.collections).filter((name) => name !== "projects").map((name) => [name, null]),
    ]);
    assert.deepEqual(new Set((await page({})).map(([, address]) => address)), new Set([null]));
  });

  it("writes an entry to the repository, not to a table", async () => {
    const response = await create({ title: "Haus am Zürichsee", year: 2024, summary: "# Hello" });
    assert.equal(response.status, 201);

    const { slug } = (await response.json()) as { slug: string };
    assert.equal(slug, "haus-am-zuerichsee");

    assert.match(file(`projects/${slug}/index.json`), /"title": "Haus am Zürichsee"/);
    assert.equal(file(`projects/${slug}/summary.mdoc`), "# Hello\n");
  });

  it("disambiguates a duplicate slug", async () => {
    await create({ title: "Doppelt" });
    const second = await create({ title: "Doppelt" });

    const entry = (await second.json()) as { slug: string };
    assert.equal(entry.slug, "doppelt-2");
  });

  it("refuses an entry the model rejects, and names the fields", async () => {
    const response = await create({ title: "Wrong year", year: "soon" });
    assert.equal(response.status, 422);

    const body = (await response.json()) as { error: { issues: Array<{ path: string }> } };
    assert.ok(body.error.issues.some((issue) => issue.path === "year"));
  });

  it("hands out a revision, and requires it back", async () => {
    await create({ title: "Concurrency" });
    const { body } = await get("concurrency");
    assert.ok(body.revision, "reading an entry must say which version it is");

    const first = await update("concurrency", { ...body.data, year: 2024 }, body.revision);
    assert.equal(first.status, 200);

    // The same revision a second time: another editor got there first.
    const second = await update("concurrency", { ...body.data, year: 1999 }, body.revision);
    assert.equal(second.status, 409);

    const after = await get("concurrency");
    assert.equal(after.body.data.year, 2024, "the first save must survive");
  });

  it("renames by moving the entry's directory", async () => {
    await create({ title: "Before" });
    const { body } = await get("before");

    const response = await update("before", { ...body.data, slug: "after" }, body.revision);
    assert.equal(response.status, 200);

    const saved = (await response.json()) as { slug: string; renamed: boolean };
    assert.equal(saved.slug, "after");
    assert.equal(saved.renamed, true);
    assert.match(file("projects/after/index.json"), /"slug": "after"/);
    assert.throws(() => file("projects/before/index.json"));
  });

  it("removes the whole entry on delete", async () => {
    await create({ title: "Doomed", summary: "Text." });
    const { body } = await get("doomed");

    const response = await harness.request(`/api/admin/collections/projects/entries/doomed?revision=${body.revision}`, {
      method: "DELETE",
    });

    assert.equal(response.status, 200);
    assert.throws(() => file("projects/doomed/index.json"));
    assert.throws(() => file("projects/doomed/summary.mdoc"));
  });

  it("refuses a delete whose slug is not one entry", async () => {
    await create({ title: "Kept", summary: "Text." });
    const tree = () => readdirSync(harness.contentRoot, { recursive: true }).map(String).sort();
    const before = tree();

    for (const slug of ["..%2Fteam", "kept%2Fsummary.mdoc", "%2E%2E"]) {
      const response = await harness.request(`/api/admin/collections/projects/entries/${slug}`, {
        method: "DELETE",
      });
      assert.ok(response.status === 400 || response.status === 404, `${slug}: ${response.status}`);
    }
    assert.deepEqual(tree(), before);
  });

  it("reports what points at an entry, so a delete can be warned about", async () => {
    await harness.request("/api/admin/collections/team/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { name: "Anna Vogt" } }),
    });
    await create({ title: "Led project", lead: "anna-vogt" });

    const response = await harness.request(
      "/api/admin/collections/team/entries/anna-vogt/references",
    );

    const body = (await response.json()) as { references: Array<{ slug: string }> };
    assert.deepEqual(body.references.map((item) => item.slug), ["led-project"]);
  });

  it("records a manual order as one file", async () => {
    const reorder = (slugs: string[], revision: string | null) =>
      harness.request("/api/admin/collections/projects/reorder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slugs, revision }),
      });
    const { orderRevision } = (await (await harness.request("/api/admin/collections/projects/entries")).json()) as {
      orderRevision: string | null;
    };

    const response = await reorder(["doppelt-2", "doppelt"], orderRevision);
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(file("projects/_order.json")), ["doppelt-2", "doppelt"]);

    // A second editor who saw the old order: their move would undo the first one unseen.
    assert.equal((await reorder(["doppelt", "doppelt-2"], orderRevision)).status, 409);
    assert.deepEqual(JSON.parse(file("projects/_order.json")), ["doppelt-2", "doppelt"]);
  });

  // A route parameter is one folder name (#213, N12, N16).
  it("refuses a slug that names two folders, and a name that is not a collection", async () => {
    await create({ title: "Victim", summary: "Text." });
    const response = await harness.request("/api/admin/collections/projects/entries/victim%2Fmedia", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { title: "Moved", slug: "moved" }, revision: null }),
    });
    assert.ok(response.status >= 400 && response.status < 500, String(response.status));
    assert.match(file("projects/victim/index.json"), /Victim/);

    const unknown = await harness.request("/api/admin/collections/constructor/entries");
    assert.ok(unknown.status >= 400 && unknown.status < 500, String(unknown.status));
  });

  it("refuses to delete an entry that a colleague saved after it was opened", async () => {
    await create({ title: "Kept" });
    const { body } = await get("kept");
    assert.equal((await update("kept", { ...body.data, year: 2024 }, body.revision)).status, 200);

    const response = await harness.request(`/api/admin/collections/projects/entries/kept?revision=${body.revision}`, { method: "DELETE" });
    assert.equal(response.status, 409);
    assert.match(file("projects/kept/index.json"), /2024/);
    assert.equal((await harness.request("/api/admin/collections/projects/entries/kept", { method: "DELETE" })).status, 400);
  });

  it("404s for an entry that is not in the repository", async () => {
    const { response } = await get("never-existed");
    assert.equal(response.status, 404);
  });

  it("lists entries in the order the model asks for", async () => {
    const sorted = await createHarness(
      {},
      {
        site: defineSite({
          collections: {
            news: collection({
              label: "News",
              defaultSort: { field: "year", direction: "desc" },
              fields: {
                title: text({ required: true }),
                slug: slug({ from: "title" }),
                year: number({ integer: true }),
              },
            }),
          },
        }),
      },
    );

    for (const [title, year] of [["Oldest", 2019], ["Newest", 2026], ["Middle", 2022]] as const) {
      await sorted.request("/api/admin/collections/news/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: { title, year } }),
      });
    }

    const response = await sorted.request("/api/admin/collections/news/entries");
    const body = (await response.json()) as { items: Array<{ title: string }> };

    assert.deepEqual(
      body.items.map((item) => item.title),
      ["Newest", "Middle", "Oldest"],
    );

    await sorted.close();
  });

  it("reports where an entry is in the repository", async () => {
    await create({ title: "Where Am I", year: 2024, summary: "# Here" });
    const { body } = await get("where-am-i");

    // A directory: `projects` has rich text and media beside the entry.
    assert.equal(body.path, "projects/where-am-i");
  });

  it("opens an empty singleton before anything has been saved", async () => {
    const response = await harness.request("/api/admin/singletons/settings");
    assert.equal(response.status, 200);

    const body = (await response.json()) as {
      data: Record<string, unknown>;
      revision: null;
      path: string;
    };
    assert.equal(body.revision, null);
    assert.equal(body.path, "settings");
  });

  it("saves a singleton to its own folder", async () => {
    const read = await harness.request("/api/admin/singletons/settings");
    const current = (await read.json()) as { data: Record<string, unknown>; revision: string | null };

    const response = await harness.request("/api/admin/singletons/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: { ...current.data, siteName: "Mica" },
        revision: current.revision,
      }),
    });

    assert.equal(response.status, 200);
    assert.match(file("settings/index.json"), /"siteName": "Mica"/);
  });

  it("refuses a singleton save based on a stale revision", async () => {
    const read = await harness.request("/api/admin/singletons/settings");
    const stale = (await read.json()) as { data: Record<string, unknown>; revision: string | null };

    const save = (name: string) =>
      harness.request("/api/admin/singletons/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: { ...stale.data, siteName: name }, revision: stale.revision }),
      });

    assert.equal((await save("First")).status, 200);
    assert.equal((await save("Second")).status, 409);
  });
});

describe("media", () => {
  let harness: TestHarness;

  before(async () => {
    harness = await createHarness();
  });
  after(() => harness.close());

  const upload = (name: string, bytes: Uint8Array, query: Record<string, string> = {}) =>
    harness.request(uploadPath(name, query), { method: "POST", body: bytes });

  it("commits an upload into the repository", async () => {
    const response = await upload("Pixel Image.png", pngBytes());

    assert.equal(response.status, 201);
    const body = (await response.json()) as {
      items: Array<{ path: string; mimeType: string; width: number; height: number }>;
    };

    const item = body.items[0]!;
    assert.equal(item.mimeType, "image/png");
    assert.equal(item.width, 1);
    assert.equal(item.path, "media/pixel-image.png");
    assert.ok(existsSync(join(harness.contentRoot, item.path)));
  });

  it("trusts the bytes rather than the declared content type", async () => {
    const disguised = new TextEncoder().encode("#!/bin/sh\necho not an image at all\n");
    const response = await upload("evil.png", disguised);

    assert.equal(response.status, 415);
  });

  it("does not let one upload overwrite another with the same name", async () => {
    const first = await upload("same.png", pngBytes());
    const second = await upload("same.png", pngBytes());

    const a = (await first.json()) as { items: Array<{ path: string }> };
    const b = (await second.json()) as { items: Array<{ path: string }> };

    assert.equal(a.items[0]!.path, "media/same.png");
    assert.equal(b.items[0]!.path, "media/same-2.png");
  });

  it("places an upload beside the entry that will reference it", async () => {
    const response = await upload("cover.png", pngBytes(), { directory: "projects/haus-a/media" });
    const body = (await response.json()) as { items: Array<{ path: string }> };

    assert.equal(body.items[0]!.path, "projects/haus-a/media/cover.png");
  });

  it("refuses a directory that leaves the content root", async () => {
    assert.equal((await upload("escape.png", pngBytes(), { directory: "../../escaped" })).status, 400);
    assert.equal(existsSync(join(harness.contentRoot, "../../escaped")), false);
  });

  it("refuses an upload directory that is not a media folder", async () => {
    for (const directory of ["projects/haus-a", "", "media/../projects"]) {
      assert.equal((await upload("stray.png", pngBytes(), { directory })).status, 400, directory);
    }
  });

  it("refuses an SVG upload, and says why", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const response = await upload("logo.svg", svg);

    assert.equal(response.status, 415);
    assert.match(((await response.json()) as { error: { message: string } }).error.message, /SVG/);
    assert.equal(existsSync(join(harness.contentRoot, "media/logo.svg")), false);
  });

  it("neither lists nor serves an SVG that is already in the repository", async () => {
    mkdirSync(join(harness.contentRoot, "media"), { recursive: true });
    writeFileSync(join(harness.contentRoot, "media/repo.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    // A leading comment hides the markup from the sniffer; the name still counts.
    writeFileSync(join(harness.contentRoot, "media/commented.svg"), "<!-- x --><svg/>");

    const list = (await (await harness.request("/api/admin/media")).json()) as {
      items: Array<{ path: string }>;
    };
    assert.equal(list.items.some((item) => item.path.endsWith(".svg")), false);

    for (const name of ["repo.svg", "commented.svg"]) {
      const response = await harness.request(`/api/admin/media/file/media/${name}`);
      assert.equal(response.status, 415, name);
    }
  });

  it("says that an LFS file was not downloaded, instead of serving its pointer", async () => {
    mkdirSync(join(harness.contentRoot, "media"), { recursive: true });
    writeFileSync(
      join(harness.contentRoot, "media/in-lfs.png"),
      "version https://git-lfs.github.com/spec/v1\noid sha256:" + "a".repeat(64) + "\nsize 2048\n",
    );

    for (const path of ["/api/admin/media/file/media/in-lfs.png", "/api/admin/media/info?path=media/in-lfs.png"]) {
      const response = await harness.request(path);
      assert.equal(response.status, 409, path);
      assert.match(((await response.json()) as { error: { message: string } }).error.message, /not downloaded/, path);
    }
  });

  it("serves a file sandboxed, and anything but an image as a download", async () => {
    await upload("shown.png", pngBytes());
    const image = await harness.request("/api/admin/media/file/media/shown.png");
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("content-security-policy"), "sandbox; default-src 'none'");
    assert.equal(image.headers.get("x-content-type-options"), "nosniff");
    assert.equal(image.headers.get("content-disposition"), null);

    mkdirSync(join(harness.contentRoot, "media"), { recursive: true });
    writeFileSync(join(harness.contentRoot, "media/report.pdf"), "%PDF-1.7\n");
    const document = await harness.request("/api/admin/media/file/media/report.pdf");
    assert.equal(document.status, 200);
    assert.equal(document.headers.get("content-security-policy"), "sandbox; default-src 'none'");
    assert.equal(document.headers.get("content-disposition"), "attachment");

    writeFileSync(join(harness.contentRoot, "media/notes.txt"), "Grüezi");
    const text = await harness.request("/api/admin/media/file/media/notes.txt");
    assert.equal(text.headers.get("content-type"), "text/plain; charset=utf-8");
  });

  it("serves no file outside the content root, however the path is encoded", async () => {
    const outside = join(harness.contentRoot, "..", `outside-${process.pid}.txt`);
    writeFileSync(outside, "secret");
    try {
      const name = `outside-${process.pid}.txt`;
      for (const path of [`..%2F${name}`, `media%2F..%2F..%2F${name}`, `%2e%2e/${name}`, `..%5C${name}`, "%E0%A4%A"]) {
        const response = await harness.request(`/api/admin/media/file/${path}`);
        assert.notEqual(response.status, 200, path);
        assert.doesNotMatch(await response.text(), /secret/, path);
      }

      const encoded = await harness.request(`/api/admin/media/file/..%2F${name}`);
      assert.equal(encoded.status, 400);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("lists what the repository holds", async () => {
    await upload("listed.png", pngBytes());

    const response = await harness.request("/api/admin/media");
    const body = (await response.json()) as { items: Array<{ path: string }> };

    assert.ok(body.items.some((item) => item.path === "media/listed.png"));
  });

  it("serves a file to a signed-in editor", async () => {
    await upload("served.png", pngBytes());

    const response = await harness.request("/api/admin/media/file/media/served.png");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
  });
});

describe("file types beside images", () => {
  let harness: TestHarness;
  before(async () => {
    harness = await createHarness();
  });
  after(() => harness.close());

  const text = (value: string) => new TextEncoder().encode(value);
  const upload = (name: string, bytes: Uint8Array, accept?: string) =>
    harness.request(uploadPath(name, accept ? { accept } : {}), { method: "POST", body: bytes });
  const typeOf = async (response: Response) => ((await response.json()) as { items: Array<{ mimeType: string; path: string }> }).items[0]!;

  const gpx = '<?xml version="1.0" encoding="UTF-8"?>\n<!-- exported -->\n<gpx version="1.1" creator="test"><trk><name>Ridge</name></trk></gpx>\n';
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 0x08, 0, 0, 0, 0, 0, 0, 0]);

  it("takes the types of the table, each from its bytes", async () => {
    const files: Array<[string, Uint8Array, string, string]> = [
      ["Ridge Walk.gpx", text(gpx), "gpx", "application/gpx+xml"],
      ["places.kml", text('<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"/>'), "kml", "application/vnd.google-earth.kml+xml"],
      ["route.geojson", text('{ "type": "FeatureCollection", "features": [] }'), "geojson", "application/geo+json"],
      ["plans.zip", zip, "zip", "application/zip"],
      ["prices.csv", text("name,price\nTea,3.50\n"), "csv", "text/csv"],
    ];
    for (const [name, bytes, accept, mimeType] of files) {
      const response = await upload(name, bytes, accept);
      assert.equal(response.status, 201, name);
      const item = await typeOf(response);
      assert.equal(item.mimeType, mimeType, name);
      assert.ok(item.path.endsWith(`.${accept}`), item.path);
    }
  });

  it("refuses a file whose bytes do not match its type", async () => {
    const refused: Array<[string, Uint8Array]> = [
      ["page.gpx", text("<!doctype html><html><script>alert(1)</script></html>")],
      ["other.gpx", text('<?xml version="1.0"?><rss version="2.0"/>')],
      ["letter.docx", zip],
      ["binary.csv", new Uint8Array([0x61, 0x2c, 0x62, 0x0a, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])],
      ["page.csv", text("<html><body>not a table</body></html>")],
      ["notes.txt", text("Some notes that are long enough.\n")],
    ];
    for (const [name, bytes] of refused) {
      assert.equal((await upload(name, bytes)).status, 415, name);
    }
  });

  it("takes only the types of the field, and says which", async () => {
    const response = await upload("track.gpx", text(gpx), "image,pdf");
    assert.equal(response.status, 415);
    assert.match(((await response.json()) as { error: { message: string } }).error.message, /Images or PDF documents.*GPX tracks/);
    assert.equal((await upload("cover.png", pngBytes(), "document")).status, 415);
    assert.equal((await upload("cover.png", pngBytes(), "gpx,image")).status, 201);
  });

  it("refuses a type that Mica does not know", async () => {
    assert.equal((await upload("track.gpx", text(gpx), "gpx,video")).status, 400);
  });

  it("serves a file that is not an image as a download in a sandbox", async () => {
    const item = await typeOf(await upload("served.gpx", text(gpx)));
    const response = await harness.request(`/api/admin/media/file/${item.path}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/gpx+xml");
    assert.equal(response.headers.get("content-disposition"), "attachment");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("content-security-policy") ?? "", /sandbox/);
  });
});

describe("media in an entry's folder, and media delete", () => {
  let harness: TestHarness;
  before(async () => {
    harness = await createHarness();
  });
  after(() => harness.close());

  const json = (path: string, method: string, body: unknown) =>
    harness.request(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const uploadTo = async (directory: string, name: string): Promise<string> => {
    const response = await harness.request(uploadPath(name, { directory }), { method: "POST", body: pngBytes() });
    assert.equal(response.status, 201);
    return ((await response.json()) as { items: Array<{ path: string }> }).items[0]!.path;
  };

  it("moves the uploads of a new entry into its folder when its URL changed before the first save", async () => {
    const staged = await uploadTo("projects/first-title/media", "front.png");
    assert.equal(staged, "projects/first-title/media/front.png");

    const created = await json("/api/admin/collections/projects/entries", "POST", { data: { title: "Final title", cover: staged } });
    assert.equal(created.status, 201);

    assert.ok(existsSync(join(harness.contentRoot, "projects/final-title/media/front.png")));
    assert.ok(!existsSync(join(harness.contentRoot, staged)));
    const stored = JSON.parse(readFileSync(join(harness.contentRoot, "projects/final-title/index.json"), "utf8"));
    assert.equal(stored.cover, "media/front.png");
  });

  it("gives one file's dimensions, and answers 304 for an unchanged file", async () => {
    const path = await uploadTo("media", "sized.png");
    const list = (await (await harness.request("/api/admin/media")).json()) as { items: Array<{ path: string; width: number | null }> };
    assert.equal(list.items.find((item) => item.path === path)?.width, null, "the list reads no file");

    const info = (await (await harness.request(`/api/admin/media/info?path=${path}`)).json()) as { width: number; height: number };
    assert.deepEqual([info.width, info.height], [1, 1]);

    const first = await harness.request(`/api/admin/media/file/${path}`);
    const etag = first.headers.get("etag");
    assert.ok(etag);
    const again = await harness.request(`/api/admin/media/file/${path}`, { headers: { "if-none-match": etag } });
    assert.equal(again.status, 304);
  });

  it("keeps a new entry's URL when its uploads went into the folder of that URL", async () => {
    const staged = await uploadTo("projects/same-title/media", "front.png");
    const created = await json("/api/admin/collections/projects/entries", "POST", { data: { title: "Same title", cover: staged } });
    assert.equal(((await created.json()) as { slug: string }).slug, "same-title");
  });

  it("does not count a folder that a discard left empty, nor treat its URL as taken", async () => {
    mkdirSync(join(harness.contentRoot, "projects/left-behind/media"), { recursive: true });
    const before = (await (await harness.request("/api/admin/overview")).json()) as { collections: Array<{ name: string; total: number }> };
    const created = await json("/api/admin/collections/projects/entries", "POST", { data: { title: "Left behind" } });
    assert.equal(((await created.json()) as { slug: string }).slug, "left-behind");
    const after = (await (await harness.request("/api/admin/overview")).json()) as { collections: Array<{ name: string; total: number }> };
    const total = (body: typeof before) => body.collections.find((item) => item.name === "projects")!.total;
    assert.equal(total(after), total(before) + 1);
  });

  it("refuses a video", async () => {
    const mp4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
    const response = await harness.request(uploadPath("clip.mp4"), { method: "POST", body: mp4 });
    assert.equal(response.status, 415);
    assert.match(((await response.json()) as { error: { message: string } }).error.message, /does not keep videos/);
  });

  it("names where a file is used, in a field or in rich text, and refuses to delete it", async () => {
    const shared = await uploadTo("media", "logo.png");
    const linked = await uploadTo("media", "plan.png");
    await json("/api/admin/collections/projects/entries", "POST", {
      data: { title: "Uses", cover: shared, summary: "See the [plan](/media/plan.png)." },
    });

    const usage = await harness.request(`/api/admin/media/usage?path=${shared}&path=${linked}`);
    const { uses } = (await usage.json()) as { uses: Record<string, Array<{ title: string }>> };
    assert.deepEqual(uses[shared]!.map((item) => item.title), ["Uses"]);
    assert.deepEqual(uses[linked]!.map((item) => item.title), ["Uses"]);

    const refused = await json("/api/admin/media/delete", "POST", { paths: [shared] });
    assert.equal(refused.status, 409);
    assert.match(((await refused.json()) as { error: { message: string } }).error.message, /"logo.png" is still used by Uses/);
    assert.ok(existsSync(join(harness.contentRoot, shared)));
  });

  it("deletes a file that nothing uses", async () => {
    const unused = await uploadTo("media", "unused.png");
    const response = await json("/api/admin/media/delete", "POST", { paths: [unused] });
    assert.equal(response.status, 200);
    assert.ok(!existsSync(join(harness.contentRoot, unused)));
  });

  it("deletes only media files, not an entry's data or the model", async () => {
    for (const path of ["projects/final-title/index.json", ".mica/schema.json"]) {
      const response = await json("/api/admin/media/delete", "POST", { paths: [path] });
      assert.equal(response.status, 400, path);
    }
    assert.ok(existsSync(join(harness.contentRoot, "projects/final-title/index.json")));
  });

  it("counts a reference link and a tag attribute in rich text as a use", async () => {
    const one = await uploadTo("media", "ref.png");
    const two = await uploadTo("media", "tag.png");
    await json("/api/admin/collections/projects/entries", "POST", {
      data: { title: "Markdoc uses", summary: `See [the plan][p].\n\n[p]: /${one}\n\n{% figure src="/${two}" /%}` },
    });
    const usage = await harness.request(`/api/admin/media/usage?path=${one}&path=${two}`);
    const { uses } = (await usage.json()) as { uses: Record<string, Array<{ title: string }>> };
    assert.deepEqual(uses[one]!.map((item) => item.title), ["Markdoc uses"]);
    assert.deepEqual(uses[two]!.map((item) => item.title), ["Markdoc uses"]);
  });

  it("refuses a new entry's upload into the folder of a saved entry", async () => {
    const query = { directory: "projects/final-title/media", newEntry: "true" };
    const response = await harness.request(uploadPath("x.png", query), { method: "POST", body: pngBytes() });
    assert.equal(response.status, 409);
  });

  it("refuses a path outside the content root", async () => {
    const response = await json("/api/admin/media/delete", "POST", { paths: ["../secret.png"] });
    assert.equal(response.status, 400);
  });
});

describe("system information", () => {
  let harness: TestHarness;

  before(async () => {
    harness = await createHarness();
  });
  after(() => harness.close());

  it("reports the repository as the developer's checkout, and no database", async () => {
    const response = await harness.request("/api/admin/system");
    assert.equal(response.status, 200);

    const body = (await response.json()) as {
      repository: { origin: string; entries: number; media: { files: number }; owner: string; sync: unknown };
    };

    assert.equal(body.repository.origin, harness.contentRoot);
    assert.equal(body.repository.entries, 0);
    assert.equal(body.repository.owner, "developer");
    assert.equal(body.repository.sync, null);
    assert.equal("database" in body, false);
  });

  it("counts entries by reading the repository", async () => {
    await harness.request("/api/admin/collections/projects/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { title: "Counted" } }),
    });

    const response = await harness.request("/api/admin/overview");
    const body = (await response.json()) as {
      collections: Array<{ name: string; total: number }>;
    };

    assert.equal(body.collections.find((item) => item.name === "projects")!.total, 1);
  });

  it("counts field kinds and finds the relations between collections", async () => {
    const response = await harness.request("/api/admin/system");
    const body = (await response.json()) as {
      schema: { relations: Array<{ from: string; to: string }>; totals: { collections: number } };
    };

    assert.equal(body.schema.totals.collections, 2);
    assert.ok(body.schema.relations.some((item) => item.from === "projects" && item.to === "team"));
  });

  it("says how this composition authenticates: not at all", async () => {
    const response = await harness.request("/api/admin/system");
    const body = (await response.json()) as {
      deployment: { auth: string; admission: string | null };
    };

    assert.match(body.deployment.auth, /none/);
    assert.equal(body.deployment.admission, null);
  });
});

describe("a forced model check", () => {
  it("reads the files again instead of joining a check that started before", async () => {
    const harness = await createHarness();
    try {
      mkdirSync(join(harness.contentRoot, ".mica"), { recursive: true });
      const first = harness.ctx.refreshModel();
      const next = defineSite({ collections: { ...testSite.collections, late: collection({ label: "Late", fields: { title: text(), slug: slug() } }) }, singletons: testSite.singletons });
      writeFileSync(join(harness.contentRoot, MANIFEST_PATH), JSON.stringify(createManifest(next, "test")));
      await Promise.all([first, harness.ctx.refreshModel({ force: true })]);
      assert.ok(harness.ctx.site.model.collections["late"]);
    } finally {
      await harness.close();
    }
  });
});

describe("a new content model", () => {
  it("is used without a restart, and an invalid one leaves the old one in use", async () => {
    const harness = await createHarness();
    try {
      const write = (contents: string) => {
        mkdirSync(join(harness.contentRoot, ".mica"), { recursive: true });
        writeFileSync(join(harness.contentRoot, MANIFEST_PATH), contents);
      };
      const next = defineSite({
        collections: { ...testSite.collections, events: collection({ label: "Events", fields: { title: text(), slug: slug() } }) },
        singletons: testSite.singletons,
      });
      write(JSON.stringify(createManifest(next, "test")));
      await harness.ctx.refreshModel({ force: true });

      const schema = (await (await harness.request("/api/admin/schema")).json()) as { collections: Array<{ name: string }> };
      assert.ok(schema.collections.some((item) => item.name === "events"));
      const created = await harness.request("/api/admin/collections/events/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: { title: "Opening" } }),
      });
      assert.equal(created.status, 201);

      write("{ not json");
      await harness.ctx.refreshModel({ force: true });
      const changes = (await (await harness.request("/api/admin/changes")).json()) as { model: { warning: string | null } };
      assert.ok(changes.model.warning);
      assert.ok(harness.ctx.site.model.collections["events"], "the model in use stays");

      const publish = await harness.request("/api/admin/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "Try", paths: {} }),
      });
      assert.equal(publish.status, 409);
      assert.equal(((await publish.json()) as { error: { message: string } }).error.message, MODEL_UNREADABLE);
    } finally {
      await harness.close();
    }
  });
});

describe("while a newer content model cannot be read", () => {
  // A save with the model in use would leave out the new fields, and still answer with success (#297).
  it("refuses every write with a 409 that names the reason, and still reads", async () => {
    const harness = await createHarness();
    const json = (method: string, body: unknown): RequestInit => ({
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    try {
      const created = await harness.request("/api/admin/collections/projects/entries", json("POST", { data: { title: "Haus A" } }));
      assert.equal(created.status, 201);
      const { revision } = (await created.json()) as { revision: string };

      const manifest = createManifest(testSite, "test");
      mkdirSync(join(harness.contentRoot, ".mica"), { recursive: true });
      writeFileSync(join(harness.contentRoot, MANIFEST_PATH), JSON.stringify({ ...manifest, protocolVersion: PROTOCOL_VERSION + 1 }));
      await harness.ctx.refreshModel({ force: true });

      const writes: Array<[string, RequestInit]> = [
        ["/api/admin/collections/projects/entries", json("POST", { data: { title: "Haus B" } })],
        ["/api/admin/collections/projects/entries/haus-a", json("PUT", { data: { title: "Haus A, new" }, revision })],
        [`/api/admin/collections/projects/entries/haus-a?revision=${revision}`, { method: "DELETE" }],
        ["/api/admin/collections/projects/reorder", json("POST", { slugs: ["haus-a"], revision: null })],
        ["/api/admin/singletons/settings", json("PUT", { data: { siteName: "Mica" }, revision: null })],
        [uploadPath("photo.png"), { method: "POST", body: pngBytes() }],
        ["/api/admin/media/delete", json("POST", { paths: ["media/photo.png"] })],
        ["/api/admin/changes/discard", json("POST", { paths: { "projects/haus-a/index.json": revision } })],
        ["/api/admin/publish", json("POST", { message: "Try", paths: {} })],
      ];
      for (const [path, init] of writes) {
        const response = await harness.request(path, init);
        assert.equal(response.status, 409, `${init.method} ${path}`);
        assert.deepEqual(((await response.json()) as { error: unknown }).error, { code: "model_unreadable", message: MODEL_UNREADABLE });
      }

      assert.equal((await harness.request("/api/admin/collections/projects/entries/haus-a")).status, 200);
      assert.equal((await harness.request("/api/admin/schema")).status, 200);
      const changes = (await (await harness.request("/api/admin/changes")).json()) as { model: { warning: string | null } };
      assert.match(changes.model.warning ?? "", /protocol version/);

      writeFileSync(join(harness.contentRoot, MANIFEST_PATH), JSON.stringify(manifest));
      await harness.ctx.refreshModel({ force: true });
      const saved = await harness.request("/api/admin/collections/projects/entries/haus-a", json("PUT", { data: { title: "Haus A, new" }, revision }));
      assert.equal(saved.status, 200);
    } finally {
      await harness.close();
    }
  });
});

describe("the error mapping", () => {
  let harness: TestHarness;
  before(async () => {
    harness = await createHarness();
  });
  after(() => harness.close());

  const errorOf = async (response: Response) => ((await response.json()) as { error: { code: string; message: string; path?: string } }).error;

  it("an unknown collection or singleton is 404", async () => {
    for (const path of ["/api/admin/collections/nope/entries", "/api/admin/singletons/nope", "/api/admin/collections/nope/entries/a"]) {
      const response = await harness.request(path);
      assert.equal(response.status, 404, path);
      assert.equal((await errorOf(response)).code, "not_found");
    }
  });

  it("a content file that Mica cannot read is 422, with its path", async () => {
    mkdirSync(join(harness.contentRoot, "projects/broken"), { recursive: true });
    writeFileSync(join(harness.contentRoot, "projects/broken/index.json"), "{ not json");
    try {
      const response = await harness.request("/api/admin/collections/projects/entries/broken");
      assert.equal(response.status, 422);
      const error = await errorOf(response);
      assert.equal(error.code, "unreadable_content");
      assert.equal(error.path, "projects/broken/index.json");
    } finally {
      rmSync(join(harness.contentRoot, "projects/broken"), { recursive: true, force: true });
    }
  });

  it("a list shows the entries that it can read, and names the files of the others (#78)", async () => {
    mkdirSync(join(harness.contentRoot, "projects/broken"), { recursive: true });
    writeFileSync(join(harness.contentRoot, "projects/broken/index.json"), "<<<<<<< HEAD\n{}");
    try {
      const response = await harness.request("/api/admin/collections/projects/entries");
      assert.equal(response.status, 200);
      const body = (await response.json()) as { items: Array<{ slug: string }>; unreadable: Array<{ slug: string; path: string; message: string }> };
      assert.ok(!body.items.some((item) => item.slug === "broken"));
      assert.deepEqual(body.unreadable.map(({ slug, path }) => ({ slug, path })), [{ slug: "broken", path: "projects/broken/index.json" }]);
      assert.match(body.unreadable[0]!.message, /^projects\/broken\/index\.json: /);
    } finally {
      rmSync(join(harness.contentRoot, "projects/broken"), { recursive: true, force: true });
    }
  });

  it("a full or read-only disk is a message for a person, not a bug (#78)", () => {
    const failure = (code: string) => Object.assign(new Error(`${code}: write failed`), { code });

    const full = apiErrorOf(new Error("The save failed.", { cause: failure("ENOSPC") }));
    assert.equal(full?.code, "storage_unavailable");
    assert.equal(full?.status, 507);
    assert.match(full!.message, /disk is full/);

    assert.match(apiErrorOf(failure("EROFS"))!.message, /read-only/);
    assert.equal(apiErrorOf(failure("EACCES"))?.code, "storage_unavailable");
    // EPERM is also a short lock on Windows, and other errors stay bugs.
    assert.equal(apiErrorOf(failure("EPERM")), null);
    assert.equal(apiErrorOf(new Error("boom")), null);
  });

  it("another content error is 400: an order for a collection that cannot sort, an entry without a title or a URL", async () => {
    const reorder = await harness.request("/api/admin/collections/team/reorder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slugs: [], revision: null }),
    });
    assert.equal(reorder.status, 400);
    assert.match((await errorOf(reorder)).message, /not manually sortable/);

    const untitled = await harness.request("/api/admin/collections/team/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: {} }),
    });
    assert.equal(untitled.status, 400);
    assert.equal((await errorOf(untitled)).code, "bad_request");
  });

  it("an invalid value is 422 with the issues, and an outdated revision 409", async () => {
    const invalid = await harness.request("/api/admin/collections/projects/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { title: "x".repeat(51) } }),
    });
    assert.equal(invalid.status, 422);
    assert.equal(((await invalid.json()) as { error: { issues: Array<{ path: string }> } }).error.issues[0]?.path, "title");

    const outdated = await harness.request("/api/admin/singletons/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { siteName: "A" }, revision: "outdated" }),
    });
    assert.equal(outdated.status, 409);
  });
});
