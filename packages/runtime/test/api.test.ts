import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { collection, defineSite, number, slug, text } from "@micacms/core";

import {
  createHarness,
  multipart,
  pngBytes,
  TEST_ORIGIN,
  testSite,
  type Session,
  type TestHarness,
} from "./helpers.js";

describe("health", () => {
  let harness: TestHarness;
  before(async () => {
    harness = await createHarness();
  });
  after(() => harness.close());

  it("reports ok, and touches the repository — there is no database to touch", async () => {
    const response = await harness.request("/health");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      uptimeSeconds: 0,
      // Named, because a check that does not say which repository it reached
      // cannot tell a misconfigured content root from a healthy one.
      repository: harness.contentRoot,
    });
  });
});

describe("content", () => {
  let harness: TestHarness;
  let session: Session;

  const create = (data: Record<string, unknown>) =>
    harness.request("/api/admin/collections/projects/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data }),
      session,
    });

  const get = async (slug: string) => {
    const response = await harness.request(
      `/api/admin/collections/projects/entries/${slug}`,
      { session },
    );
    return { response, body: (await response.json()) as Record<string, any> };
  };

  const update = (slug: string, data: Record<string, unknown>, revision?: string | null) =>
    harness.request(`/api/admin/collections/projects/entries/${slug}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data, revision }),
      session,
    });

  const file = (path: string) => readFileSync(join(harness.contentRoot, path), "utf8");

  before(async () => {
    harness = await createHarness();
    session = await harness.signIn();
  });
  after(() => harness.close());

  it("exposes the model so the admin can render forms it does not know about", async () => {
    const response = await harness.request("/api/admin/schema", { session });
    const body = (await response.json()) as {
      collections: Array<{ name: string; titleField: string; slugField: string; fields: object }>;
    };

    const projects = body.collections.find((item) => item.name === "projects")!;
    assert.equal(projects.titleField, "title");
    assert.equal(projects.slugField, "slug");
    assert.ok("gallery" in projects.fields);
  });

  it("writes an entry to the repository, not to a table", async () => {
    const response = await create({ title: "Haus am Zürichsee", year: 2024, summary: "# Hello" });
    assert.equal(response.status, 201);

    const { slug } = (await response.json()) as { slug: string };
    assert.equal(slug, "haus-am-zuerichsee");

    // The files are the product. Assert on them directly.
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
    const response = await create({ title: "", year: 2024 });
    assert.equal(response.status, 422);

    const body = (await response.json()) as { error: { issues: Array<{ path: string }> } };
    assert.ok(body.error.issues.some((issue) => issue.path === "title"));
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

    const response = await harness.request("/api/admin/collections/projects/entries/doomed", {
      method: "DELETE",
      session,
    });

    assert.equal(response.status, 200);
    assert.throws(() => file("projects/doomed/index.json"));
    assert.throws(() => file("projects/doomed/summary.mdoc"));
  });

  it("reports what points at an entry, so a delete can be warned about", async () => {
    await harness.request("/api/admin/collections/team/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { name: "Anna Vogt" } }),
      session,
    });
    await create({ title: "Led project", lead: "anna-vogt" });

    const response = await harness.request(
      "/api/admin/collections/team/entries/anna-vogt/references",
      { session },
    );

    const body = (await response.json()) as { references: Array<{ slug: string }> };
    assert.deepEqual(body.references.map((item) => item.slug), ["led-project"]);
  });

  it("records a manual order as one file", async () => {
    const response = await harness.request("/api/admin/collections/projects/reorder", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slugs: ["doppelt-2", "doppelt"] }),
      session,
    });

    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(file("projects/_order.json")), ["doppelt-2", "doppelt"]);
  });

  it("404s for an entry that is not in the repository", async () => {
    const { response } = await get("never-existed");
    assert.equal(response.status, 404);
  });

  /**
   * `defaultSort` described an order for a long time without producing one:
   * nothing read the option, so a collection came back in whatever order its
   * directory was read in.
   */
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
    const sortedSession = await sorted.signIn();

    for (const [title, year] of [["Oldest", 2019], ["Newest", 2026], ["Middle", 2022]] as const) {
      await sorted.request("/api/admin/collections/news/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: { title, year } }),
        session: sortedSession,
      });
    }

    const response = await sorted.request("/api/admin/collections/news/entries", {
      session: sortedSession,
    });
    const body = (await response.json()) as { items: Array<{ title: string }> };

    assert.deepEqual(
      body.items.map((item) => item.title),
      ["Newest", "Middle", "Oldest"],
    );

    await sorted.close();
  });

  /**
   * Whether an entry is a directory or a single file follows from the model,
   * so the editor is told rather than left to work it out. Getting this wrong
   * would show an editor a path that is not there.
   */
  it("reports where an entry is in the repository", async () => {
    await create({ title: "Where Am I", year: 2024, summary: "# Here" });
    const { body } = await get("where-am-i");

    // A directory: `projects` has rich text and media beside the entry.
    assert.equal(body.path, "projects/where-am-i");
  });

  /* ------------------------------------------------------- singletons */

  it("opens an empty singleton before anything has been saved", async () => {
    const response = await harness.request("/api/admin/singletons/settings", { session });
    assert.equal(response.status, 200);

    const body = (await response.json()) as {
      data: Record<string, unknown>;
      revision: null;
      path: string;
    };
    assert.equal(body.revision, null);
    // A plain file, because `settings` declares no rich text and no media.
    assert.equal(body.path, "settings.json");
  });

  it("saves a singleton to its own file", async () => {
    const read = await harness.request("/api/admin/singletons/settings", { session });
    const current = (await read.json()) as { data: Record<string, unknown>; revision: string | null };

    const response = await harness.request("/api/admin/singletons/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: { ...current.data, siteName: "Mica" },
        revision: current.revision,
      }),
      session,
    });

    assert.equal(response.status, 200);
    assert.match(file("settings.json"), /"siteName": "Mica"/);
  });

  it("refuses a singleton save based on a stale revision", async () => {
    const read = await harness.request("/api/admin/singletons/settings", { session });
    const stale = (await read.json()) as { data: Record<string, unknown>; revision: string | null };

    const save = (name: string) =>
      harness.request("/api/admin/singletons/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: { ...stale.data, siteName: name }, revision: stale.revision }),
        session,
      });

    assert.equal((await save("First")).status, 200);
    assert.equal((await save("Second")).status, 409);
  });
});

describe("media", () => {
  let harness: TestHarness;
  let session: Session;

  before(async () => {
    harness = await createHarness();
    session = await harness.signIn();
  });
  after(() => harness.close());

  const upload = (form: FormData) =>
    harness.request("/api/admin/media", { method: "POST", body: form, session });

  it("commits an upload into the repository", async () => {
    const response = await upload(
      multipart([{ name: "Pixel Image.png", bytes: pngBytes(), type: "image/png" }]),
    );

    assert.equal(response.status, 201);
    const body = (await response.json()) as {
      items: Array<{ path: string; mimeType: string; width: number; height: number }>;
    };

    const item = body.items[0]!;
    assert.equal(item.mimeType, "image/png");
    assert.equal(item.width, 1);
    // A path into the repository, with a name a person would recognise —
    // not a ULID and not a URL on this server.
    assert.equal(item.path, "media/pixel-image.png");
    assert.ok(existsSync(join(harness.contentRoot, item.path)));
  });

  it("trusts the bytes rather than the declared content type", async () => {
    const disguised = new TextEncoder().encode("#!/bin/sh\necho not an image at all\n");
    const response = await upload(
      multipart([{ name: "evil.png", bytes: disguised, type: "image/png" }]),
    );

    assert.equal(response.status, 415);
  });

  it("does not let one upload overwrite another with the same name", async () => {
    const first = await upload(multipart([{ name: "same.png", bytes: pngBytes(), type: "image/png" }]));
    const second = await upload(multipart([{ name: "same.png", bytes: pngBytes(), type: "image/png" }]));

    const a = (await first.json()) as { items: Array<{ path: string }> };
    const b = (await second.json()) as { items: Array<{ path: string }> };

    assert.equal(a.items[0]!.path, "media/same.png");
    assert.equal(b.items[0]!.path, "media/same-2.png");
  });

  it("places an upload beside the entry that will reference it", async () => {
    const form = multipart([{ name: "cover.png", bytes: pngBytes(), type: "image/png" }]);
    form.set("directory", "projects/haus-a/media");

    const response = await upload(form);
    const body = (await response.json()) as { items: Array<{ path: string }> };

    assert.equal(body.items[0]!.path, "projects/haus-a/media/cover.png");
  });

  it("refuses a directory that leaves the content root", async () => {
    const form = multipart([{ name: "escape.png", bytes: pngBytes(), type: "image/png" }]);
    form.set("directory", "../../escaped");

    assert.equal((await upload(form)).status, 500);
    assert.equal(existsSync(join(harness.contentRoot, "../../escaped")), false);
  });

  it("lists what the repository holds", async () => {
    await upload(multipart([{ name: "listed.png", bytes: pngBytes(), type: "image/png" }]));

    const response = await harness.request("/api/admin/media", { session });
    const body = (await response.json()) as { items: Array<{ path: string }> };

    assert.ok(body.items.some((item) => item.path === "media/listed.png"));
  });

  it("serves a file to a signed-in editor", async () => {
    await upload(multipart([{ name: "served.png", bytes: pngBytes(), type: "image/png" }]));

    const response = await harness.request("/api/admin/media/file/media/served.png", { session });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
  });
});

describe("system information", () => {
  let harness: TestHarness;
  let session: Session;

  before(async () => {
    harness = await createHarness();
    session = await harness.signIn();
  });
  after(() => harness.close());

  it("reports the repository, and no database where the composition has none", async () => {
    const response = await harness.request("/api/admin/system", { session });
    assert.equal(response.status, 200);

    const body = (await response.json()) as {
      repository: { origin: string; entries: number; media: { files: number } };
      database: unknown;
    };

    assert.equal(body.repository.origin, harness.contentRoot);
    assert.equal(body.repository.entries, 0);
    // The local composition keeps no database, and the system page says so
    // rather than inventing an empty one.
    assert.equal(body.database, null);
  });

  it("counts entries by reading the repository", async () => {
    await harness.request("/api/admin/collections/projects/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { title: "Counted" } }),
      session,
    });

    const response = await harness.request("/api/admin/overview", { session });
    const body = (await response.json()) as {
      collections: Array<{ name: string; total: number }>;
    };

    assert.equal(body.collections.find((item) => item.name === "projects")!.total, 1);
  });

  it("counts field kinds and finds the relations between collections", async () => {
    const response = await harness.request("/api/admin/system", { session });
    const body = (await response.json()) as {
      schema: { relations: Array<{ from: string; to: string }>; totals: { collections: number } };
    };

    assert.equal(body.schema.totals.collections, 2);
    assert.ok(body.schema.relations.some((item) => item.from === "projects" && item.to === "team"));
  });

  it("says how this composition authenticates: not at all", async () => {
    const response = await harness.request("/api/admin/system", { session });
    const body = (await response.json()) as {
      deployment: { site: string; auth: string; admission: string | null };
    };

    assert.equal(body.deployment.site, "default");
    assert.match(body.deployment.auth, /none/);
    assert.equal(body.deployment.admission, null);
  });
});
