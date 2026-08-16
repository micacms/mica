import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { collection, defineSite, slug, text } from "@micacms/model";

import {
  ADMIN_EMAIL,
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

  it("reports ok, and actually touches both stores", async () => {
    const response = await harness.request("/health");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      uptimeSeconds: 0,
      database: "ok",
      // Named, because a check that does not say which repository it reached
      // cannot tell a misconfigured content root from a healthy one.
      repository: harness.contentRoot,
    });
  });
});

describe("authentication", () => {
  let harness: TestHarness;
  before(async () => {
    harness = await createHarness();
  });
  after(() => harness.close());

  it("issues an HttpOnly session cookie and a readable CSRF cookie", async () => {
    // Local mode: /login signs the developer in and redirects, with no
    // identity provider in the way.
    const response = await harness.request("/api/auth/login");

    assert.equal(response.status, 302);
    const cookies = response.headers.getSetCookie();

    const session = cookies.find((value) => value.startsWith("mica_session="))!;
    const csrf = cookies.find((value) => value.startsWith("mica_csrf="))!;

    assert.match(session, /HttpOnly/i);
    assert.match(session, /SameSite=Lax/i);
    // Readable by design: the SPA echoes it back as a header.
    assert.doesNotMatch(csrf, /HttpOnly/i);
  });

  it("says how this deployment authenticates, without requiring a session", async () => {
    const response = await harness.request("/api/auth/config");
    assert.equal(response.status, 200);

    assert.deepEqual(await response.json(), {
      mode: "local",
      authDisabled: true,
      provider: null,
    });
  });

  it("rejects a request with no session", async () => {
    const response = await harness.request("/api/admin/schema");
    assert.equal(response.status, 401);
  });

  it("returns the signed-in user from /me", async () => {
    const session = await harness.signIn();
    const response = await harness.request("/api/auth/me", { session });
    const body = (await response.json()) as { user: Record<string, unknown> };

    assert.equal(body.user["email"], ADMIN_EMAIL);
    assert.equal(body.user["role"], "admin");
    // There is no such field any more, and there must never be one again.
    assert.ok(!("passwordHash" in body.user));
  });

  it("issues a different session token on each sign-in", async () => {
    const first = await harness.signIn();
    const second = await harness.signIn();
    assert.notEqual(first.cookie, second.cookie);
  });

  it("signs out and invalidates the session", async () => {
    const session = await harness.signIn();
    const loggedOut = await harness.request("/api/auth/logout", { method: "POST", session });
    assert.equal(loggedOut.status, 200);

    const after = await harness.request("/api/auth/me", { session });
    assert.equal(after.status, 401);
  });

  /**
   * The property that matters most in the new model: authentication and
   * authorization are separate, and the second is re-read on every request.
   */
  it("refuses a valid session whose membership has been revoked", async () => {
    const userId = harness.addMember({ email: "temporary@example.com", role: "editor" });
    const session = await harness.signIn("temporary@example.com");

    assert.equal((await harness.request("/api/auth/me", { session })).status, 200);

    harness.ctx.repositories.memberships.revoke(harness.ctx.siteId, userId);

    // Immediately, not when the cookie happens to expire.
    const after = await harness.request("/api/auth/me", { session });
    assert.equal(after.status, 403);
  });

  it("keeps administrator actions away from editors", async () => {
    harness.addMember({ email: "editor@example.com", role: "editor" });
    const session = await harness.signIn("editor@example.com");

    // Content is open to editors...
    assert.equal((await harness.request("/api/admin/schema", { session })).status, 200);

    // ...managing people is not.
    const forbidden = await harness.request("/api/admin/users", { session });
    assert.equal(forbidden.status, 403);
  });
});

/**
 * The local experience, which is the one almost everybody meets first: `npx
 * @micacms/cms`, a link, and the editor. No sign-in screen, because there is
 * no identity provider to send anybody to and therefore no question to ask.
 */
describe("opening the editor in local mode", () => {
  /** A stand-in for the built SPA: `adminSpaRoutes` mounts on `index.html`. */
  function fakeAdminBuild(): string {
    const directory = mkdtempSync(join(tmpdir(), "mica-test-admin-"));
    writeFileSync(join(directory, "index.html"), "<!doctype html><title>Mica</title>");
    return directory;
  }

  it("signs the developer in while serving the page", async () => {
    const harness = await createHarness({}, { adminDir: fakeAdminBuild() });

    const page = await harness.request("/admin/");
    assert.equal(page.status, 200);

    const cookies = page.headers.getSetCookie();
    const session = cookies.find((value) => value.startsWith("mica_session="));
    assert.ok(session, "the page load is the sign-in");

    // And the session it issued is a real one: the SPA's first request
    // succeeds, so it never renders a sign-in screen.
    const me = await harness.request("/api/auth/me", {
      headers: { cookie: session.split(";")[0]! },
    });

    assert.equal(me.status, 200);
    const body = (await me.json()) as { user: { email: string; role: string } };
    assert.equal(body.user.email, "developer@localhost");
    assert.equal(body.user.role, "admin");

    await harness.close();
  });

  it("issues one session, not one per page load", async () => {
    const harness = await createHarness({}, { adminDir: fakeAdminBuild() });

    const first = await harness.request("/admin/");
    const cookie = first.headers.getSetCookie()[0]!.split(";")[0]!;

    const second = await harness.request("/admin/", { headers: { cookie } });
    assert.deepEqual(second.headers.getSetCookie(), []);

    await harness.close();
  });

  it("changes nothing about the API: no session is still no access", async () => {
    const harness = await createHarness({}, { adminDir: fakeAdminBuild() });

    const response = await harness.request("/api/admin/schema");
    assert.equal(response.status, 401);

    await harness.close();
  });

  it("does not happen where there is an identity provider to ask", async () => {
    const harness = await createHarness(
      {
        MICA_MODE: "self-hosted",
        OIDC_ISSUER: "https://id.example.com",
        OIDC_CLIENT_ID: "mica",
      },
      { adminDir: fakeAdminBuild() },
    );

    const page = await harness.request("/admin/");
    assert.equal(page.status, 200);
    assert.deepEqual(page.headers.getSetCookie(), []);

    await harness.close();
  });
});

describe("CSRF protection", () => {
  let harness: TestHarness;
  let session: Session;

  before(async () => {
    harness = await createHarness();
    session = await harness.signIn();
  });
  after(() => harness.close());

  it("rejects a write without the token header", async () => {
    const response = await harness.request("/api/admin/collections/projects/entries", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: session.cookie },
      body: JSON.stringify({ data: { title: "X" } }),
    });
    assert.equal(response.status, 403);
  });

  it("rejects a write with a token that does not match the session", async () => {
    const response = await harness.request("/api/admin/collections/projects/entries", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
        "x-csrf-token": "not-the-real-token",
      },
      body: JSON.stringify({ data: { title: "X" } }),
    });
    assert.equal(response.status, 403);
  });

  it("rejects a write from a foreign origin", async () => {
    const response = await harness.request("/api/admin/collections/projects/entries", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
        cookie: session.cookie,
        "x-csrf-token": session.csrfToken,
      },
      body: JSON.stringify({ data: { title: "X" } }),
    });
    assert.equal(response.status, 403);
  });

  it("allows a write with a matching token", async () => {
    const response = await harness.request("/api/admin/collections/projects/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { title: "Allowed" } }),
      session,
    });
    assert.equal(response.status, 201);
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

  it("requires a session, unlike the public media route it replaces", async () => {
    const response = await harness.request("/api/admin/media/file/media/served.png");
    assert.equal(response.status, 401);
  });
});

describe("site membership", () => {
  let harness: TestHarness;

  before(async () => {
    harness = await createHarness();
    harness.addMember({ email: "editor@example.com", role: "editor" });
  });
  after(() => harness.close());

  it("lists the people who can edit this site", async () => {
    const session = await harness.signIn();
    const response = await harness.request("/api/admin/users", { session });
    const body = (await response.json()) as { users: Array<Record<string, unknown>> };

    assert.equal(response.status, 200);
    assert.deepEqual(
      body.users.map((user) => user["email"]).sort(),
      [ADMIN_EMAIL, "editor@example.com"],
    );
    // Nothing resembling a credential, now or ever.
    for (const user of body.users) {
      assert.ok(!("passwordHash" in user));
      assert.ok(!("mustChangePassword" in user));
    }
  });

  /**
   * Inviting somebody who has never signed in is the normal case, not an edge
   * case: Mica does not create people, so an invitation is a membership
   * waiting for its identity.
   */
  it("invites an address that has no account yet, and marks it pending", async () => {
    // In a deployment that actually has a provider: "pending" means nobody has
    // vouched for this address yet, and local mode has no provider to do so.
    const hosted = await createHarness({
      MICA_MODE: "self-hosted",
      OIDC_ISSUER: "https://auth.example.com",
      OIDC_CLIENT_ID: "mica",
    });

    try {
      hosted.addMember({ email: ADMIN_EMAIL, role: "admin" });
      const session = await hosted.signIn();

      const response = await hosted.request("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "new@example.com", name: "New", role: "editor" }),
        session,
      });

      assert.equal(response.status, 201);
      const body = (await response.json()) as { user: { pending: boolean; role: string } };

      assert.equal(body.user.pending, true);
      assert.equal(body.user.role, "editor");
    } finally {
      await hosted.close();
    }
  });

  it("does not call anybody pending when there is no provider to wait for", async () => {
    const session = await harness.signIn();
    const response = await harness.request("/api/admin/users", { session });
    const body = (await response.json()) as { users: Array<{ pending: boolean }> };

    // Local mode: the distinction is meaningless, so it is not made.
    assert.ok(body.users.every((user) => user.pending === false));
  });

  it("refuses to invite somebody who is already a member", async () => {
    const session = await harness.signIn();
    const response = await harness.request("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "editor@example.com", role: "editor" }),
      session,
    });

    assert.equal(response.status, 409);
  });

  it("refuses to demote or remove the last administrator", async () => {
    const session = await harness.signIn();
    const admin = harness.ctx.repositories.users.findByEmail(ADMIN_EMAIL)!;

    const demote = await harness.request(`/api/admin/users/${admin.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "editor" }),
      session,
    });
    assert.equal(demote.status, 409);

    const remove = await harness.request(`/api/admin/users/${admin.id}`, {
      method: "DELETE",
      session,
    });
    assert.equal(remove.status, 409);
  });

  /**
   * Removing access ends every session immediately. Waiting for a cookie to
   * expire is not "removed".
   */
  it("signs somebody out everywhere the moment their access is removed", async () => {
    const userId = harness.addMember({ email: "leaving@example.com", role: "editor" });
    const theirs = await harness.signIn("leaving@example.com");
    const admin = await harness.signIn();

    assert.equal((await harness.request("/api/auth/me", { session: theirs })).status, 200);

    const removed = await harness.request(`/api/admin/users/${userId}`, {
      method: "DELETE",
      session: admin,
    });
    assert.equal(removed.status, 200);

    assert.equal((await harness.request("/api/auth/me", { session: theirs })).status, 401);
  });

  /** The account survives a removal; only the membership goes. */
  it("keeps the account, because it may belong to another site", async () => {
    const userId = harness.addMember({ email: "elsewhere@example.com", role: "editor" });
    const session = await harness.signIn();

    await harness.request(`/api/admin/users/${userId}`, { method: "DELETE", session });

    assert.ok(harness.ctx.repositories.users.findById(userId));
    assert.equal(harness.ctx.repositories.memberships.find(harness.ctx.siteId, userId), undefined);
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

  it("separates the content repository from Mica's own database", async () => {
    const response = await harness.request("/api/admin/system", { session });
    assert.equal(response.status, 200);

    const body = (await response.json()) as {
      repository: { origin: string; entries: number; media: { files: number } };
      database: { users: number; version: number };
    };

    // The shape is the point: content is in the repository, and the database
    // holds users. Losing the second must not look like losing the first.
    assert.equal(body.repository.origin, harness.contentRoot);
    assert.equal(body.repository.entries, 0);
    assert.equal(body.database.users, 1);
    assert.ok(body.database.version >= 2, "the content tables must have been dropped");
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

  it("keeps deployment details to administrators", async () => {
    harness.addMember({ email: "editor@example.com", role: "editor" });
    const editor = await harness.signIn("editor@example.com");

    const response = await harness.request("/api/admin/system", { session: editor });
    const body = (await response.json()) as { deployment: unknown };

    assert.equal(body.deployment, null);
  });
});
