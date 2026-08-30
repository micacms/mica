/**
 * The admission policy, as a unit.
 *
 * The self-hosted composition tests prove the policy holds at the HTTP
 * boundary; these prove the rules themselves, where a wrong answer is easiest
 * to read.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAdmissionPolicy } from "../dist/index.js";
import type { SessionIdentity } from "../dist/index.js";

const person = (overrides: Partial<SessionIdentity> = {}): SessionIdentity => ({
  issuer: "https://id.example.test",
  subject: "subject-1",
  email: "person@example.com",
  emailVerified: true,
  name: "Person",
  groups: [],
  ...overrides,
});

const policy = (rules: Partial<Parameters<typeof createAdmissionPolicy>[0]>) =>
  createAdmissionPolicy({ admitGroups: [], admitDomains: [], admitSubjects: [], ...rules });

describe("admission rules", () => {
  it("admits by group, and accepts a Keycloak path for a bare name", () => {
    const p = policy({ admitGroups: ["mica-editors"] });

    assert.equal(p.admits(person({ groups: ["mica-editors"] })).admitted, true);
    assert.equal(p.admits(person({ groups: ["/mica-editors"] })).admitted, true);
    assert.equal(p.admits(person({ groups: ["everyone"] })).admitted, false);
  });

  it("admits a subject only at its own issuer", () => {
    const p = policy({
      admitSubjects: [{ issuer: "https://id.example.test", subject: "subject-1" }],
    });

    assert.equal(p.admits(person()).admitted, true);
    // The same subject string from another provider is a different person.
    assert.equal(p.admits(person({ issuer: "https://id.attacker.test" })).admitted, false);
  });

  it("admits a domain only when the provider verified the address", () => {
    const p = policy({ admitDomains: ["example.com"] });

    assert.equal(p.admits(person()).admitted, true);

    const unverified = p.admits(person({ emailVerified: false }));
    assert.equal(unverified.admitted, false);
    assert.match((unverified as { reason: string }).reason, /verified/);
  });

  it("lets the explicit list in even when the group claim is missing", () => {
    const p = policy({
      admitGroups: ["mica-editors"],
      admitSubjects: [{ issuer: "https://id.example.test", subject: "subject-1" }],
    });

    assert.equal(p.admits(person({ groups: [] })).admitted, true);
  });

  it("summarises what is in force, for the startup log", () => {
    const p = policy({ admitGroups: ["mica-editors"], admitDomains: ["example.com"] });
    assert.match(p.summary, /group=mica-editors/);
    assert.match(p.summary, /domain=example.com/);
  });
});
