/**
 * Staging with a draft store, through the API.
 *
 * The staged harness runs with a provider-shaped configuration but a local
 * connector as the repository, so "the provider" is a temporary directory the
 * test can inspect: a save must NOT reach it, and a publish must reach it as
 * one change set. The draft store here is the in-memory reference
 * implementation; the SQLite twin proves the same semantics in its own unit
 * tests, in the app that owns it.
 */

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { createHarness, multipart, pngBytes, type Session, type TestHarness } from "./helpers.js";

async function draftHarness(): Promise<{ harness: TestHarness; session: Session }> {
  const harness = await createHarness({}, { staged: true });
  const session = await harness.signIn();
  return { harness, session };
}

const post = (harness: TestHarness, session: Session, path: string, body: unknown) =>
  harness.request(path, {
    method: "POST",
    session,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("staging with a draft store", () => {
  let harness: TestHarness;
  let session: Session;

  before(async () => {
    ({ harness, session } = await draftHarness());
  });
  after(() => harness.close());

  const entryPath = "projects/alpine-haus/index.json";

  it("a save stages instead of committing", async () => {
    const response = await post(harness, session, "/api/admin/collections/projects/entries", {
      data: { title: "Alpine Haus", year: 2020 },
    });
    assert.equal(response.status, 201);

    // The repository has not moved — that is what staging means.
    assert.equal(existsSync(join(harness.contentRoot, entryPath)), false);

    const changes = await harness.request("/api/admin/changes", { session });
    const status = (await changes.json()) as {
      workspace: string;
      changes: Array<{ path: string; kind: string; owner: { kind: string; label: string } }>;
      validation: { ok: boolean };
    };

    assert.equal(status.workspace, "draft-store");
    assert.equal(status.validation.ok, true);

    const change = status.changes.find((c) => c.path === entryPath);
    assert.ok(change, "the staged entry appears in the change list");
    assert.equal(change.kind, "create");
    assert.equal(change.owner.kind, "entry");
    assert.equal(change.owner.label, "Projects: Alpine Haus");
  });

  it("the editor reads its own staged content back", async () => {
    const response = await harness.request(
      "/api/admin/collections/projects/entries/alpine-haus",
      { session },
    );
    assert.equal(response.status, 200);

    const entry = (await response.json()) as { data: { title: string }; revision: string };
    assert.equal(entry.data.title, "Alpine Haus");
    assert.ok(entry.revision, "a staged entry still has a revision to send back with a save");
  });

  it("refuses to publish without a commit message", async () => {
    const response = await post(harness, session, "/api/admin/publish", { message: "   " });
    assert.equal(response.status, 400);
  });

  it("publishes the pending set as one change set and clears it", async () => {
    const response = await post(harness, session, "/api/admin/publish", {
      message: "Add the Alpine Haus",
    });
    assert.equal(response.status, 200);

    const result = (await response.json()) as { state: string; revision: string };
    assert.equal(result.state, "published");
    assert.ok(result.revision);

    // Now, and only now, the repository holds the entry.
    const written = JSON.parse(readFileSync(join(harness.contentRoot, entryPath), "utf8"));
    assert.equal(written.title, "Alpine Haus");

    const changes = await harness.request("/api/admin/changes", { session });
    const status = (await changes.json()) as { changes: unknown[]; baseRevision: string | null };
    assert.deepEqual(status.changes, []);
    assert.equal(status.baseRevision, null);
  });

  it("refuses to publish an empty set", async () => {
    const response = await post(harness, session, "/api/admin/publish", { message: "Nothing" });
    assert.equal(response.status, 400);
  });

  it("a repository that moved under a staged path refuses publication", async () => {
    const detail = await harness.request(
      "/api/admin/collections/projects/entries/alpine-haus",
      { session },
    );
    const { revision } = (await detail.json()) as { revision: string };

    const saved = await harness.request("/api/admin/collections/projects/entries/alpine-haus", {
      method: "PUT",
      session,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { title: "Alpine Haus", year: 2021 }, revision }),
    });
    assert.equal(saved.status, 200);

    // Somebody pushes to the repository behind the draft's back.
    writeFileSync(
      join(harness.contentRoot, entryPath),
      JSON.stringify({ title: "Moved outside", slug: "alpine-haus" }),
    );

    const response = await post(harness, session, "/api/admin/publish", {
      message: "Try to publish over it",
    });
    assert.equal(response.status, 409);

    // Nothing was cleared: the draft is intact for the editor to reconcile.
    const changes = await harness.request("/api/admin/changes", { session });
    const status = (await changes.json()) as { changes: Array<{ path: string }> };
    assert.ok(status.changes.some((change) => change.path === entryPath));
  });

  it("discard drops a staged change without touching the repository", async () => {
    const response = await post(harness, session, "/api/admin/changes/discard", {
      paths: [entryPath],
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { discarded: [entryPath] });

    const changes = await harness.request("/api/admin/changes", { session });
    const status = (await changes.json()) as { changes: unknown[] };
    assert.deepEqual(status.changes, []);

    // The outside edit is untouched — discard forgets the draft, nothing else.
    const onDisk = JSON.parse(readFileSync(join(harness.contentRoot, entryPath), "utf8"));
    assert.equal(onDisk.title, "Moved outside");
  });
});

describe("draft media", () => {
  let harness: TestHarness;
  let session: Session;

  before(async () => {
    ({ harness, session } = await draftHarness());
  });
  after(() => harness.close());

  it("an upload is staged, and served to the editor from the draft", async () => {
    const upload = await harness.request("/api/admin/media", {
      method: "POST",
      session,
      body: multipart([{ name: "photo.png", bytes: pngBytes(), type: "image/png" }]),
    });
    assert.equal(upload.status, 201);

    const { items } = (await upload.json()) as { items: Array<{ path: string }> };
    const mediaPath = items[0]!.path;

    // Not in the repository yet…
    assert.equal(existsSync(join(harness.contentRoot, mediaPath)), false);

    // …but the editor can already see it, behind the session.
    const served = await harness.request(`/api/admin/media/file/${mediaPath}`, { session });
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/png");

    const changes = await harness.request("/api/admin/changes", { session });
    const status = (await changes.json()) as {
      changes: Array<{ path: string; owner: { kind: string } }>;
    };
    assert.equal(status.changes.find((c) => c.path === mediaPath)?.owner.kind, "media");

    // Publication moves the bytes into the repository.
    const published = await post(harness, session, "/api/admin/publish", {
      message: "Add a photo",
    });
    assert.equal(published.status, 200);
    assert.equal(existsSync(join(harness.contentRoot, mediaPath)), true);
  });
});

describe("model drift under a pending draft", () => {
  let harness: TestHarness;
  let session: Session;

  before(async () => {
    ({ harness, session } = await draftHarness());
  });
  after(() => harness.close());

  it("refuses to publish when the manifest moved after startup", async () => {
    const saved = await post(harness, session, "/api/admin/collections/projects/entries", {
      data: { title: "Drifting" },
    });
    assert.equal(saved.status, 201);

    // The repository gains a model change while the draft is pending. The
    // harness started with no manifest, so any manifest at all is drift.
    mkdirSync(join(harness.contentRoot, ".mica"), { recursive: true });
    writeFileSync(join(harness.contentRoot, ".mica/schema.json"), "{}");

    const response = await post(harness, session, "/api/admin/publish", {
      message: "Publish across the drift",
    });
    assert.equal(response.status, 409);

    const body = (await response.json()) as { error: { message: string } };
    assert.match(body.error.message, /content model changed/i);
    assert.match(body.error.message, /restart/i);

    rmSync(join(harness.contentRoot, ".mica"), { recursive: true, force: true });
  });
});

describe("before/after comparison with a draft store", () => {
  let harness: TestHarness;
  let session: Session;

  before(async () => {
    ({ harness, session } = await draftHarness());
  });
  after(() => harness.close());

  const compare = async (query: string) => {
    const response = await harness.request(`/api/admin/changes/compare?${query}`, { session });
    return { status: response.status, body: (await response.json()) as {
      before: Record<string, unknown> | null;
      after: Record<string, unknown> | null;
    } };
  };

  it("compares the repository against the staged overlay", async () => {
    // Publish one version, then stage an edit on top of it.
    const created = await post(harness, session, "/api/admin/collections/projects/entries", {
      data: { title: "Chalet", year: 2019 },
    });
    assert.equal(created.status, 201);
    const published = await post(harness, session, "/api/admin/publish", {
      message: "First version",
    });
    assert.equal(published.status, 200);

    const updated = await harness.request("/api/admin/collections/projects/entries/chalet", {
      method: "PUT",
      session,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { title: "Chalet, extended", slug: "chalet", year: 2019 } }),
    });
    assert.equal(updated.status, 200);

    const { status, body } = await compare("kind=entry&collection=projects&slug=chalet");
    assert.equal(status, 200);
    assert.equal(body.before?.["title"], "Chalet");
    assert.equal(body.after?.["title"], "Chalet, extended");
  });

  it("a staged creation has no before", async () => {
    const created = await post(harness, session, "/api/admin/collections/projects/entries", {
      data: { title: "Neubau", year: 2026 },
    });
    assert.equal(created.status, 201);

    const { body } = await compare("kind=entry&collection=projects&slug=neubau");
    assert.equal(body.before, null);
    assert.equal(body.after?.["title"], "Neubau");
  });

  it("a staged deletion has no after", async () => {
    const removed = await harness.request("/api/admin/collections/projects/entries/chalet", {
      method: "DELETE",
      session,
    });
    assert.equal(removed.status, 200);

    const { body } = await compare("kind=entry&collection=projects&slug=chalet");
    assert.equal(body.before?.["title"], "Chalet");
    assert.equal(body.after, null);
  });

  it("a URL change is one renamed entry, compared without the moved files", async () => {
    // Published by hand, with a colocated image the rename must carry along.
    const base = join(harness.contentRoot, "projects/scheune");
    mkdirSync(join(base, "media"), { recursive: true });
    writeFileSync(join(base, "media/front.png"), pngBytes());
    writeFileSync(
      join(base, "index.json"),
      JSON.stringify({ title: "Scheune", slug: "scheune", year: 2021, cover: "media/front.png" }),
    );

    const renamed = await harness.request("/api/admin/collections/projects/entries/scheune", {
      method: "PUT",
      session,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: { title: "Scheune", slug: "alte-scheune", year: 2021, cover: "projects/scheune/media/front.png" },
      }),
    });
    assert.equal(renamed.status, 200);

    const changes = await harness.request("/api/admin/changes", { session });
    const { changes: list } = (await changes.json()) as {
      changes: Array<{ path: string; owner: { slug?: string; renamedFrom?: string } }>;
    };
    const moved = list.filter((change) => change.path.startsWith("projects/scheune/") || change.path.startsWith("projects/alte-scheune/"));
    assert.ok(moved.length >= 4, "both folders' files are listed");
    for (const change of moved) {
      assert.equal(change.owner.slug, "alte-scheune", change.path);
      assert.equal(change.owner.renamedFrom, "scheune", change.path);
    }

    const { body } = await compare("kind=entry&collection=projects&slug=alte-scheune&from=scheune");
    assert.equal(body.before?.["slug"], "scheune");
    assert.equal(body.after?.["slug"], "alte-scheune");
    assert.equal(body.before?.["cover"], body.after?.["cover"]);
  });

  it("refuses a malformed or unknown target", async () => {
    const malformed = await harness.request("/api/admin/changes/compare?kind=entry", { session });
    assert.equal(malformed.status, 400);

    const unknown = await compare("kind=entry&collection=nope&slug=chalet");
    assert.equal(unknown.status, 400);
  });
});
