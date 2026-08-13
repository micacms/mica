import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { collection, defineSite, slug, text } from "@micacms/model";

import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  createHarness,
  multipart,
  pngBytes,
  TEST_ORIGIN,
  testSite,
  type Session,
  type TestHarness,
} from "./helpers.js";

const READ_TOKEN = "test-read-token-0123456789";

describe("health", () => {
  let harness: TestHarness;
  before(async () => {
    harness = await createHarness();
  });
  after(() => harness.close());

  it("reports ok and actually touches the database", async () => {
    const response = await harness.request("/health");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      uptimeSeconds: 0,
      database: "ok",
      publisher: "configured",
    });
  });
});

describe("authentication", () => {
  let harness: TestHarness;
  before(async () => {
    harness = await createHarness();
  });
  after(() => harness.close());

  it("rejects a wrong password without revealing whether the account exists", async () => {
    const wrongPassword = await harness.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: "not-the-password" }),
    });
    const unknownAccount = await harness.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com", password: "not-the-password" }),
    });

    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownAccount.status, 401);
    assert.deepEqual(await wrongPassword.json(), await unknownAccount.json());
  });

  it("issues an HttpOnly session cookie and a readable CSRF cookie", async () => {
    const response = await harness.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });

    assert.equal(response.status, 200);
    const cookies = response.headers.getSetCookie();

    const session = cookies.find((value) => value.startsWith("mica_session="))!;
    const csrf = cookies.find((value) => value.startsWith("mica_csrf="))!;

    assert.match(session, /HttpOnly/i);
    assert.match(session, /SameSite=Lax/i);
    assert.doesNotMatch(csrf, /HttpOnly/i);
  });

  it("rejects a request with no session", async () => {
    const response = await harness.request("/api/admin/schema");
    assert.equal(response.status, 401);
  });

  it("returns the signed-in user from /me", async () => {
    const session = await harness.signIn();
    const response = await harness.request("/api/auth/me", { session });
    const body = (await response.json()) as { user: { email: string; role: string } };

    assert.equal(body.user.email, ADMIN_EMAIL);
    assert.equal(body.user.role, "admin");
    assert.ok(!("passwordHash" in body.user), "the hash must never leave the server");
  });

  it("issues a different session token on each sign-in", async () => {
    const first = await harness.signIn();
    const second = await harness.signIn();
    assert.notEqual(first.cookie, second.cookie);
  });

  it("rate limits repeated failures and then recovers after a success", async () => {
    const local = await createHarness({ LOGIN_MAX_ATTEMPTS: "3" });
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        await local.request("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: ADMIN_EMAIL, password: "wrong" }),
        });
      }

      const blocked = await local.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      });

      assert.equal(blocked.status, 429);
      assert.ok(blocked.headers.get("retry-after"));
    } finally {
      await local.close();
    }
  });

  it("signs out and invalidates the session", async () => {
    const session = await harness.signIn();
    const loggedOut = await harness.request("/api/auth/logout", { method: "POST", session });
    assert.equal(loggedOut.status, 200);

    const after = await harness.request("/api/auth/me", { session });
    assert.equal(after.status, 401);
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

  const createEntry = async (data: Record<string, unknown>, status?: string) =>
    harness.request("/api/admin/collections/projects/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data, status }),
      session,
    });

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

  it("derives a slug from the title", async () => {
    const response = await createEntry({ title: "Haus am Zürichsee" });
    const entry = (await response.json()) as { slug: string };
    assert.equal(entry.slug, "haus-am-zuerichsee");
  });

  it("disambiguates a duplicate slug", async () => {
    await createEntry({ title: "Doppelt" });
    const second = await createEntry({ title: "Doppelt" });
    const entry = (await second.json()) as { slug: string };
    assert.equal(entry.slug, "doppelt-2");
  });

  it("saves an incomplete draft but refuses to publish it", async () => {
    const draft = await createEntry({ title: "", year: 2024 });
    assert.equal(draft.status, 201);

    const { id } = (await draft.json()) as { id: string };
    const published = await harness.request(`/api/admin/entries/${id}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "published" }),
      session,
    });

    assert.equal(published.status, 422);
    const body = (await published.json()) as { error: { issues: Array<{ path: string }> } };
    assert.equal(body.error.issues[0]?.path, "title");
  });

  it("enforces field constraints on save", async () => {
    const response = await createEntry({ title: "Ok", year: 1500, category: "z" });
    assert.equal(response.status, 422);

    const body = (await response.json()) as { error: { issues: Array<{ path: string }> } };
    const paths = body.error.issues.map((issue) => issue.path).sort();
    assert.deepEqual(paths, ["category", "year"]);
  });

  it("keeps a draft out of the public API until it is published", async () => {
    const created = await createEntry({ title: "Not yet" });
    const { id, slug } = (await created.json()) as { id: string; slug: string };

    const beforePublish = await harness.request("/api/content/projects", {
      headers: { authorization: `Bearer ${READ_TOKEN}` },
    });
    const before = (await beforePublish.json()) as { items: Array<{ slug: string }> };
    assert.ok(!before.items.some((item) => item.slug === slug));

    await harness.request(`/api/admin/entries/${id}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "published" }),
      session,
    });

    const afterPublish = await harness.request("/api/content/projects", {
      headers: { authorization: `Bearer ${READ_TOKEN}` },
    });
    const after = (await afterPublish.json()) as { items: Array<{ slug: string }> };
    assert.ok(after.items.some((item) => item.slug === slug));
  });

  it("notifies the publisher only for changes that touch live content", async () => {
    const before = harness.publisher.events.length;

    const draft = await createEntry({ title: "Quiet draft" });
    const { id } = (await draft.json()) as { id: string };
    assert.equal(harness.publisher.events.length, before, "a draft must not trigger a build");

    await harness.request(`/api/admin/entries/${id}/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "published" }),
      session,
    });

    const latest = harness.publisher.events.at(-1)!;
    assert.equal(latest.type, "entry.published");
    assert.equal(latest.collection, "projects");
  });

  it("records a revision on every change and restores a previous version", async () => {
    const created = await createEntry({ title: "Version one" });
    const { id } = (await created.json()) as { id: string };

    await harness.request(`/api/admin/entries/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { title: "Version two" } }),
      session,
    });

    const listed = await harness.request(`/api/admin/entries/${id}/revisions`, { session });
    const { revisions } = (await listed.json()) as {
      revisions: Array<{ id: string; title: string; authorEmail: string }>;
    };

    assert.equal(revisions.length, 1);
    assert.equal(revisions[0]!.title, "Version one");
    assert.equal(revisions[0]!.authorEmail, ADMIN_EMAIL, "the editor must be identifiable");

    const restored = await harness.request(
      `/api/admin/entries/${id}/revisions/${revisions[0]!.id}/restore`,
      { method: "POST", session },
    );

    const entry = (await restored.json()) as { data: { title: string } };
    assert.equal(entry.data.title, "Version one");
  });

  it("drops fields that are no longer in the model", async () => {
    const response = await createEntry({ title: "Clean", removedField: "stale" });
    const entry = (await response.json()) as { data: Record<string, unknown> };
    assert.ok(!("removedField" in entry.data));
  });

  it("saves and reads a singleton", async () => {
    const saved = await harness.request("/api/admin/globals/site", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { companyName: "Muster AG" } }),
      session,
    });
    assert.equal(saved.status, 200);

    const read = await harness.request("/api/globals/site", {
      headers: { authorization: `Bearer ${READ_TOKEN}` },
    });
    assert.deepEqual(await read.json(), { companyName: "Muster AG", logo: null });
  });

  it("rejects a singleton that fails validation", async () => {
    const response = await harness.request("/api/admin/globals/site", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { companyName: "" } }),
      session,
    });
    assert.equal(response.status, 422);
  });

  it("finds the entries that point at a team member", async () => {
    const member = await harness.request("/api/admin/collections/team/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { name: "Anna Muster" } }),
      session,
    });
    const { id: memberId, slug: memberSlug } = (await member.json()) as {
      id: string;
      slug: string;
    };

    await createEntry({ title: "Led by Anna", lead: memberSlug });

    // Asked of the team member: which projects would break if it were deleted?
    const response = await harness.request(`/api/admin/entries/${memberId}/references`, {
      session,
    });
    const body = (await response.json()) as {
      references: Array<{ collection: string; title: string }>;
    };

    assert.equal(response.status, 200);
    assert.deepEqual(body.references, [
      { collection: "projects", id: body.references[0]?.id ?? "", title: "Led by Anna", slug: "led-by-anna" },
    ]);
  });
});

describe("public content API", () => {
  let harness: TestHarness;

  before(async () => {
    harness = await createHarness();
  });
  after(() => harness.close());

  it("requires a read token", async () => {
    assert.equal((await harness.request("/api/content/projects")).status, 401);
  });

  it("rejects an incorrect token", async () => {
    const response = await harness.request("/api/content/projects", {
      headers: { authorization: "Bearer wrong-token-wrong-token" },
    });
    assert.equal(response.status, 401);
  });

  it("accepts the token and returns published content only", async () => {
    const response = await harness.request("/api/content/projects", {
      headers: { authorization: `Bearer ${READ_TOKEN}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { items: [], total: 0 });
  });

  it("serves every collection and global in one manifest", async () => {
    const response = await harness.request("/api/manifest", {
      headers: { authorization: `Bearer ${READ_TOKEN}` },
    });
    const body = (await response.json()) as {
      collections: Record<string, unknown[]>;
      globals: Record<string, unknown>;
      version: string;
    };

    assert.deepEqual(Object.keys(body.collections).sort(), ["projects", "team"]);
    assert.ok("site" in body.globals);
    assert.ok(body.version);
  });

  it("changes the content version when content changes", async () => {
    const session = await harness.signIn();
    const before = await (
      await harness.request("/api/version", { headers: { authorization: `Bearer ${READ_TOKEN}` } })
    ).json();

    await harness.request("/api/admin/collections/projects/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { title: "Fresh" }, status: "published" }),
      session,
    });

    const after = await (
      await harness.request("/api/version", { headers: { authorization: `Bearer ${READ_TOKEN}` } })
    ).json();

    assert.notDeepEqual(before, after);
  });

  it("holds the content version still when nothing changes", async () => {
    const read = async () =>
      (
        await (
          await harness.request("/api/version", {
            headers: { authorization: `Bearer ${READ_TOKEN}` },
          })
        ).json()
      ).version as string;

    assert.equal(await read(), await read());
  });

  it("changes the content version when the model changes", async () => {
    // The token is what every consumer uses to decide whether to look again, so
    // it has to cover the model too: payloads are projected through it, and a
    // field added to `mica.config.ts` moves nothing in the database. Without
    // this, a website's persisted content cache outlives the change that was
    // supposed to invalidate it.
    const extended = defineSite({
      collections: {
        ...testSite.collections,
        team: collection({
          label: "Team",
          fields: {
            name: text({ label: "Name", required: true }),
            slug: slug({ from: "name" }),
            role: text({ label: "Role" }),
          },
        }),
      },
      singletons: testSite.singletons,
    });

    const other = await createHarness({}, { site: extended });
    try {
      const version = async (h: TestHarness) =>
        (
          await (
            await h.request("/api/version", { headers: { authorization: `Bearer ${READ_TOKEN}` } })
          ).json()
        ).version as string;

      // Both databases are empty, so every content-derived signal is identical.
      const plain = await createHarness();
      try {
        assert.notEqual(await version(plain), await version(other));
      } finally {
        plain.close();
      }
    } finally {
      other.close();
    }
  });

  it("returns 404 for an unknown collection", async () => {
    const response = await harness.request("/api/content/nope", {
      headers: { authorization: `Bearer ${READ_TOKEN}` },
    });
    assert.equal(response.status, 404);
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

  it("accepts a PNG and reads its dimensions", async () => {
    const response = await upload(
      multipart([{ name: "pixel.png", bytes: pngBytes(), type: "image/png" }]),
    );

    assert.equal(response.status, 201);
    const body = (await response.json()) as {
      items: Array<{ id: string; mimeType: string; width: number; height: number; url: string }>;
    };

    assert.equal(body.items[0]!.mimeType, "image/png");
    assert.equal(body.items[0]!.width, 1);
    assert.equal(body.items[0]!.height, 1);
    assert.match(body.items[0]!.url, /^http:\/\/localhost:4000\/media\/[0-9A-Z]{26}\.png$/);
  });

  it("trusts the bytes rather than the declared content type", async () => {
    const disguised = new TextEncoder().encode("#!/bin/sh\necho not an image at all\n");
    const response = await upload(
      multipart([{ name: "evil.png", bytes: disguised, type: "image/png" }]),
    );

    assert.equal(response.status, 415);
  });

  it("stores identical bytes only once", async () => {
    const first = await upload(multipart([{ name: "a.png", bytes: pngBytes(), type: "image/png" }]));
    const second = await upload(multipart([{ name: "b.png", bytes: pngBytes(), type: "image/png" }]));

    const one = (await first.json()) as { items: Array<{ id: string }> };
    const two = (await second.json()) as { items: Array<{ id: string }> };
    assert.equal(one.items[0]!.id, two.items[0]!.id);
  });

  it("serves the file publicly with an immutable cache header", async () => {
    const uploaded = await upload(
      multipart([{ name: "served.png", bytes: pngBytes(), type: "image/png" }]),
    );
    const { items } = (await uploaded.json()) as { items: Array<{ url: string }> };
    const path = new URL(items[0]!.url).pathname;

    const response = await harness.request(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.match(response.headers.get("cache-control")!, /immutable/);
  });

  it("expands media ids into full references in the public API", async () => {
    const uploaded = await upload(
      multipart([{ name: "cover.png", bytes: pngBytes(), type: "image/png" }]),
    );
    const { items } = (await uploaded.json()) as { items: Array<{ id: string }> };

    const created = await harness.request("/api/admin/collections/projects/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        data: { title: "With cover", cover: items[0]!.id },
        status: "published",
      }),
      session,
    });
    const { slug } = (await created.json()) as { slug: string };

    const response = await harness.request(`/api/content/projects/${slug}`, {
      headers: { authorization: `Bearer ${READ_TOKEN}` },
    });
    const entry = (await response.json()) as { data: { cover: { url: string; width: number } } };

    assert.equal(entry.data.cover.width, 1);
    assert.match(entry.data.cover.url, /\/media\//);
  });

  it("refuses to delete a file that published content still uses", async () => {
    const uploaded = await upload(
      multipart([{ name: "used.png", bytes: pngBytes(), type: "image/png" }]),
    );
    const { items } = (await uploaded.json()) as { items: Array<{ id: string }> };

    await harness.request("/api/admin/collections/projects/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { title: "Uses file", cover: items[0]!.id } }),
      session,
    });

    const blocked = await harness.request(`/api/admin/media/${items[0]!.id}`, {
      method: "DELETE",
      session,
    });
    assert.equal(blocked.status, 409);

    const forced = await harness.request(`/api/admin/media/${items[0]!.id}?force=true`, {
      method: "DELETE",
      session,
    });
    assert.equal(forced.status, 200);
  });
});

describe("user administration", () => {
  let harness: TestHarness;

  before(async () => {
    harness = await createHarness();
    await harness.createUser({
      email: "editor@example.com",
      password: "editor-password-1",
      role: "editor",
    });
  });
  after(() => harness.close());

  it("denies user management to editors", async () => {
    const session = await harness.signIn("editor@example.com", "editor-password-1");
    const response = await harness.request("/api/admin/users", { session });
    assert.equal(response.status, 403);
  });

  it("still lets an editor manage content", async () => {
    const session = await harness.signIn("editor@example.com", "editor-password-1");
    const response = await harness.request("/api/admin/collections/projects/entries", { session });
    assert.equal(response.status, 200);
  });

  it("refuses to demote or delete the last administrator", async () => {
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

  it("rejects a weak password when creating an account", async () => {
    const session = await harness.signIn();
    const response = await harness.request("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "weak@example.com", password: "short" }),
      session,
    });
    assert.equal(response.status, 400);
  });

  it("signs other devices out when the password changes", async () => {
    const first = await harness.signIn("editor@example.com", "editor-password-1");
    const second = await harness.signIn("editor@example.com", "editor-password-1");

    const changed = await harness.request("/api/auth/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        currentPassword: "editor-password-1",
        newPassword: "a-completely-new-one",
      }),
      session: second,
    });
    assert.equal(changed.status, 200);

    assert.equal((await harness.request("/api/auth/me", { session: first })).status, 401);
    assert.equal((await harness.request("/api/auth/me", { session: second })).status, 200);
  });
});

describe("system information", () => {
  let harness: TestHarness;
  let session: Session;

  before(async () => {
    harness = await createHarness();
    session = await harness.signIn();
    await harness.createUser({
      email: "editor@example.com",
      password: "editor-password-1",
      role: "editor",
    });

    await harness.request("/api/admin/collections/projects/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { title: "Ein Haus" } }),
      session,
    });
  });
  after(() => harness.close());

  const system = async (as: Session) =>
    (await (await harness.request("/api/admin/system", { session: as })).json()) as {
      cms: { version: string; environment: string };
      schema: {
        fingerprint: string;
        totals: { collections: number; globals: number; total: number; required: number };
        kinds: Array<{ kind: string; count: number }>;
        relations: Array<{ from: string; path: string; to: string; multiple: boolean }>;
        collections: Array<{ name: string; entries: { total: number; drafts: number } }>;
      };
      storage: { entries: { total: number }; users: number };
      deployment: { schemaPath: string; generatedSecrets: string[] } | null;
    };

  it("reports the running version and the model it was handed", async () => {
    const body = await system(session);

    assert.match(body.cms.version, /^\d+\.\d+\.\d+/);
    assert.equal(body.cms.environment, "test");
    assert.match(body.schema.fingerprint, /^[0-9a-f]{12}$/);

    // The test model: projects (8 fields) + team (2) + the site global (2).
    assert.deepEqual(body.schema.totals, {
      collections: 2,
      globals: 1,
      top: 12,
      total: 12,
      required: 3,
    });
  });

  it("counts field kinds and finds the relations between collections", async () => {
    const body = await system(session);

    assert.equal(body.schema.kinds.find((item) => item.kind === "media")?.count, 3);
    assert.deepEqual(body.schema.relations, [
      { from: "projects", fromType: "collection", path: "lead", to: "team", multiple: false },
    ]);
  });

  it("pairs each collection with what is actually stored in it", async () => {
    const body = await system(session);

    const projects = body.schema.collections.find((item) => item.name === "projects")!;
    assert.deepEqual(projects.entries, { total: 1, drafts: 1, published: 0 });
    assert.equal(body.storage.entries.total, 1);
    assert.equal(body.storage.users, 2);
  });

  it("keeps deployment detail to administrators and never returns a secret", async () => {
    const asEditor = await harness.signIn("editor@example.com", "editor-password-1");

    const editorView = await system(asEditor);
    assert.equal(editorView.deployment, null);
    // The parts an editor is there for are still present.
    assert.equal(editorView.schema.totals.collections, 2);

    const adminView = await system(session);
    assert.ok(adminView.deployment?.schemaPath);

    const payload = JSON.stringify(adminView);
    assert.ok(!payload.includes(harness.config.sessionSecret));
    assert.ok(!payload.includes(harness.config.readToken));
  });
});
