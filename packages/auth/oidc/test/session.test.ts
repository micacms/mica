/**
 * The cookie session, as a unit: sealing, expiry, and the sliding idle window.
 *
 * The self-hosted composition tests prove the cookie works at the HTTP
 * boundary; these control the clock.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { cookieNames, createSessionService } from "../src/index.js";
import type { AuthConfig, SessionIdentity } from "../src/index.js";

const HOUR = 3600_000;

const config = {
  sessionSecret: "0".repeat(32),
  cookieSecure: false,
  admitGroups: ["mica-editors"],
  MICA_SESSION_TTL_HOURS: 8,
  MICA_SESSION_IDLE_HOURS: 4,
} as AuthConfig;

const person: SessionIdentity = {
  issuer: "https://id.example.test",
  subject: "subject-1",
  email: "person@example.com",
  emailVerified: true,
  name: "Person",
  groups: ["/mica-editors", "sales", "everyone"],
};

describe("cookie sessions", () => {
  beforeEach(() => mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-10T08:00:00Z") }));
  afterEach(() => mock.timers.reset());

  it("round-trips the identity, keeping only the groups a rule names", () => {
    const sessions = createSessionService(config);
    const { cookie } = sessions.create(person);

    const record = sessions.resolve(cookie);
    assert.ok(record);
    assert.equal(record.identity.subject, "subject-1");
    assert.equal(record.identity.emailVerified, true);
    assert.deepEqual(record.identity.groups, ["/mica-editors"]);
  });

  it("does not show the identity in the cookie", () => {
    const { cookie } = createSessionService(config).create(person);
    assert.doesNotMatch(Buffer.from(cookie, "base64url").toString("latin1"), /person@example/);
  });

  it("refuses an identity too large for a cookie", () => {
    assert.throws(
      () => createSessionService(config).create({ ...person, name: "x".repeat(4000) }),
      /does not fit in a cookie/,
    );
  });

  it("expires after the idle window without a refresh", () => {
    const sessions = createSessionService(config);
    const { cookie } = sessions.create(person);

    mock.timers.tick(4 * HOUR - 1000);
    assert.ok(sessions.resolve(cookie));
    mock.timers.tick(1000);
    assert.equal(sessions.resolve(cookie), null);
  });

  it("slides the idle window while in use, up to the absolute lifetime", () => {
    const sessions = createSessionService(config);
    let { cookie, record } = sessions.create(person);

    // Fresh: nothing to re-issue.
    assert.equal(sessions.refresh(record), null);

    for (let hour = 0; hour < 7; hour++) {
      mock.timers.tick(HOUR);
      const refreshed = sessions.refresh(sessions.resolve(cookie)!);
      assert.ok(refreshed);
      ({ cookie, record } = refreshed);
    }

    // Seven hours in and active, but capped at eight from sign-in.
    assert.equal(record.expiresAt, "2026-10-10T16:00:00.000Z");
    mock.timers.tick(HOUR);
    assert.equal(sessions.resolve(cookie), null);
  });
});

describe("cookieNames", () => {
  it("uses browser-enforced prefixes only for Secure cookies", () => {
    assert.deepEqual(cookieNames(true), {
      session: "__Host-mica_session",
      csrf: "__Host-mica_csrf",
      // Scoped to /api/auth, so it cannot be __Host-.
      transaction: "__Secure-mica_oidc",
    });
    assert.deepEqual(cookieNames(false), {
      session: "mica_session",
      csrf: "mica_csrf",
      transaction: "mica_oidc",
    });
  });
});
