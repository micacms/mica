/**
 * The self-hosted composition: sessions, admission and CSRF around the
 * auth-neutral runtime. The content and media behaviour behind the gate is
 * the runtime's and is tested there; what these tests own is the gate.
 */

import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";

import {
  ADMITTED,
  createHarness,
  ISSUER,
  REFUSED,
  PROVIDER,
  type Session,
  type TestHarness,
} from "./helpers.js";

describe("health", () => {
  let harness: TestHarness;
  before(async () => {
    harness = await createHarness(PROVIDER);
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

describe("sessions", () => {
  let harness: TestHarness;
  before(async () => {
    harness = await createHarness();
  });
  after(() => harness.close());

  it("says that this deployment authenticates, and with whom", async () => {
    const response = await harness.request("/api/auth/config");
    assert.equal(response.status, 200);

    assert.deepEqual(await response.json(), {
      authRequired: true,
      provider: "id.example.test",
    });
  });

  it("rejects a request with no session", async () => {
    const response = await harness.request("/api/admin/schema");
    assert.equal(response.status, 401);
  });

  it("issues a different session token on each sign-in", async () => {
    const first = await harness.signIn();
    const second = await harness.signIn();
    assert.notEqual(first.cookie, second.cookie);
  });

  /** The session is the cookie: signing out is clearing it in the browser. */
  it("signs out by clearing both cookies", async () => {
    const session = await harness.signIn();
    const loggedOut = await harness.request("/api/auth/logout", { method: "POST", session });
    assert.equal(loggedOut.status, 200);

    const cleared = loggedOut.headers.getSetCookie();
    assert.ok(cleared.some((line) => /^mica_session=;.*Max-Age=0/.test(line)));
    assert.ok(cleared.some((line) => /^mica_csrf=;.*Max-Age=0/.test(line)));
  });

  it("rejects a session cookie that was altered", async () => {
    const session = await harness.signIn();
    const value = session.cookie.match(/mica_session=([^;]+)/)![1]!;
    const flipped = value.slice(0, 20) + (value[20] === "A" ? "B" : "A") + value.slice(21);

    const response = await harness.request("/api/auth/me", {
      session: { ...session, cookie: session.cookie.replace(value, flipped) },
    });
    assert.equal(response.status, 401);
  });

  it("re-issues the session cookie while it is in use", async () => {
    mock.timers.enable({ apis: ["Date"], now: Date.now() });
    try {
      const session = await harness.signIn();

      const fresh = await harness.request("/api/auth/me", { session });
      assert.ok(!fresh.headers.getSetCookie().some((line) => line.startsWith("mica_session=")));

      mock.timers.tick(6 * 60 * 1000);
      const later = await harness.request("/api/auth/me", { session });
      assert.equal(later.status, 200);
      assert.ok(later.headers.getSetCookie().some((line) => /^mica_session=[^;]+;/.test(line)));
    } finally {
      mock.timers.reset();
    }
  });

  it("rejects a session sealed with another secret", async () => {
    const other = await createHarness({ SESSION_SECRET: "1".repeat(32) });
    const foreign = await other.signIn();
    await other.close();

    assert.equal((await harness.request("/api/auth/me", { session: foreign })).status, 401);
  });
});

describe("admission", () => {
  // The harness admits `mica-editors` by default; a test that states its own
  // rule must clear that first, or every rule would pass through the group.
  const authenticated = (rules: Partial<NodeJS.ProcessEnv>) =>
    createHarness({ MICA_ADMIT_GROUP: undefined, ...rules });

  it("admits a group the operator named, and refuses everybody else", async () => {
    const harness = await authenticated({ MICA_ADMIT_GROUP: "mica-editors" });

    const admitted = await harness.signIn(ADMITTED);
    assert.equal((await harness.request("/api/auth/me", { session: admitted })).status, 200);

    const refused = await harness.signIn(REFUSED);
    const response = await harness.request("/api/auth/me", { session: refused });
    assert.equal(response.status, 403);

    await harness.close();
  });

  it("reports who is signed in, from the claims and not from a row", async () => {
    const harness = await authenticated({ MICA_ADMIT_GROUP: "mica-editors" });
    const session = await harness.signIn(ADMITTED);

    const response = await harness.request("/api/auth/me", { session });
    const body = (await response.json()) as {
      identity: { email: string; name: string; subject: string };
    };

    assert.equal(body.identity.email, ADMITTED.email);
    assert.equal(body.identity.subject, ADMITTED.subject);
    // There is no role, because there are no roles.
    assert.ok(!("role" in body.identity));

    await harness.close();
  });

  it("accepts a Keycloak group path where a bare name was configured", async () => {
    const harness = await authenticated({ MICA_ADMIT_GROUP: "mica-editors" });
    const session = await harness.signIn({ ...ADMITTED, groups: ["/mica-editors"] });

    assert.equal((await harness.request("/api/auth/me", { session })).status, 200);
    await harness.close();
  });

  it("admits an explicit subject, keyed by issuer and never by email", async () => {
    const harness = await authenticated({
      MICA_ADMIT_SUBJECTS: `${ISSUER}|${ADMITTED.subject}`,
    });

    const session = await harness.signIn(ADMITTED);
    assert.equal((await harness.request("/api/auth/me", { session })).status, 200);

    // The same address at a different provider is a different person.
    const impostor = await harness.signIn({
      ...ADMITTED,
      issuer: "https://id.attacker.test",
      subject: ADMITTED.subject,
    });
    assert.equal((await harness.request("/api/auth/me", { session: impostor })).status, 403);

    await harness.close();
  });

  it("admits a domain only when the provider says the address is verified", async () => {
    const harness = await authenticated({ MICA_ADMIT_DOMAIN: "example.com" });

    const verified = await harness.signIn({ ...ADMITTED, groups: [] });
    assert.equal((await harness.request("/api/auth/me", { session: verified })).status, 200);

    const unverified = await harness.signIn({
      ...ADMITTED,
      subject: "unverified",
      emailVerified: false,
      groups: [],
    });
    assert.equal((await harness.request("/api/auth/me", { session: unverified })).status, 403);

    await harness.close();
  });

  it("admits a listed address only when the provider says it is verified", async () => {
    const harness = await authenticated({ MICA_ADMIT_EMAILS: ADMITTED.email.toUpperCase() });

    const verified = await harness.signIn({ ...ADMITTED, groups: [] });
    assert.equal((await harness.request("/api/auth/me", { session: verified })).status, 200);

    const unverified = await harness.signIn({
      ...ADMITTED,
      subject: "unverified",
      emailVerified: false,
      groups: [],
    });
    assert.equal((await harness.request("/api/auth/me", { session: unverified })).status, 403);

    await harness.close();
  });

  /**
   * The property the membership table used to give, kept: admission is re-read
   * on every request rather than copied into the session at sign-in.
   */
  it("refuses a live session the moment the rules stop admitting it", async () => {
    const harness = await authenticated({ MICA_ADMIT_GROUP: "mica-editors" });
    const session = await harness.signIn(ADMITTED);

    assert.equal((await harness.request("/api/auth/me", { session })).status, 200);

    // The gate re-reads the policy per request, so replacing the answer is
    // exactly what an operator's configuration change does.
    harness.auth.admission.admits = () => ({ admitted: false, reason: "removed" });

    assert.equal((await harness.request("/api/auth/me", { session })).status, 403);
    await harness.close();
  });

  /** Everybody admitted is an editor: there is no second gate behind the first. */
  it("gives every admitted person the whole editor", async () => {
    const harness = await authenticated({ MICA_ADMIT_GROUP: "mica-editors" });
    const session = await harness.signIn(ADMITTED);

    for (const path of ["/api/admin/schema", "/api/admin/overview", "/api/admin/system"]) {
      assert.equal((await harness.request(path, { session })).status, 200, path);
    }

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

describe("the draft store behind a provider repository", () => {
  let harness: TestHarness;
  let session: Session;

  before(async () => {
    // The temporary directory is the repository.
    harness = await createHarness(PROVIDER);
    session = await harness.signIn();
  });
  after(() => harness.close());

  it("stages a save in the database, and publishes it as one change set", async () => {
    const saved = await harness.request("/api/admin/collections/projects/entries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { title: "Persistent" } }),
      session,
    });
    assert.equal(saved.status, 201);

    // In the database, not the repository: the SQLite draft store holds it.
    const staged = harness.db!.all<{ path: string }>("SELECT path FROM drafts ORDER BY path");
    assert.ok(staged.some((row) => row.path === "projects/persistent/index.json"));

    const published = await harness.request("/api/admin/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Publish the persistent entry" }),
      session,
    });
    assert.equal(published.status, 200);

    assert.equal(
      harness.db!.all("SELECT path FROM drafts").length,
      0,
      "publication clears what it published",
    );
  });
});

describe("system information", () => {
  let harness: TestHarness;
  before(async () => {
    harness = await createHarness(PROVIDER);
  });
  after(() => harness.close());

  it("reports the database and what decides who may edit", async () => {
    const session = await harness.signIn();
    const response = await harness.request("/api/admin/system", { session });
    const body = (await response.json()) as {
      database: { version: number } | null;
      deployment: { auth: string; admission: string | null };
    };

    assert.ok(body.database);
    assert.equal(body.database.version, 3);
    assert.match(body.deployment.auth, /oidc:/);
    assert.match(body.deployment.admission ?? "", /group=mica-editors/);
  });
});

describe("a deployment on a working tree", () => {
  it("opens no database, because it has no draft store to keep", async () => {
    const harness = await createHarness();
    assert.equal(harness.db, undefined);

    const health = (await (await harness.request("/health")).json()) as Record<string, unknown>;
    assert.equal(health["status"], "ok");
    assert.ok(!("database" in health));

    const session = await harness.signIn();
    const system = (await (await harness.request("/api/admin/system", { session })).json()) as {
      database: unknown;
    };
    assert.equal(system.database, null);

    await harness.close();
  });
});
