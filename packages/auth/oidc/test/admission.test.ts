/**
 * The admission policy, as a unit.
 *
 * The self-hosted composition tests prove the policy holds at the HTTP
 * boundary; these prove the rules themselves, where a wrong answer is easiest
 * to read.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAdmissionPolicy } from "../src/index.js";
import type { SessionIdentity } from "../src/index.js";

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
  createAdmissionPolicy({
    admitGroups: [],
    admitDomains: [],
    admitEmails: [],
    admitSubjects: [],
    ...rules,
  });

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

  it("admits a Google account by domain only when its Workspace domain (hd) is admitted", () => {
    const p = policy({ admitDomains: ["example.com", "example.org"] });
    const google = (overrides: Partial<SessionIdentity> = {}) =>
      person({ issuer: "https://accounts.google.com", ...overrides });

    assert.equal(p.admits(google({ hostedDomain: "example.com" })).admitted, true);
    // `hd` is the organisation's primary domain, so an address on another admitted domain still counts.
    assert.equal(p.admits(google({ email: "person@example.org", hostedDomain: "Example.com" })).admitted, true);

    // A personal Google account with a company address is verified, but has no `hd`.
    const personal = p.admits(google());
    assert.equal(personal.admitted, false);
    assert.match((personal as { reason: string }).reason, /Google Workspace domain \(hd\).*MICA_ADMIT_EMAILS/);

    assert.equal(p.admits(google({ hostedDomain: "other.example" })).admitted, false);
    // Another provider sends no `hd`, and the rule does not ask for it.
    assert.equal(p.admits(person()).admitted, true);
  });

  it("admits a listed Google address without a Workspace domain", () => {
    const p = policy({ admitDomains: ["example.com"], admitEmails: ["person@example.com"] });

    assert.equal(p.admits(person({ issuer: "https://accounts.google.com" })).admitted, true);
  });

  it("admits a listed address, case-insensitively, only when verified", () => {
    const p = policy({ admitEmails: ["alice@gmail.com"] });

    assert.equal(p.admits(person({ email: "Alice@Gmail.com" })).admitted, true);
    assert.equal(p.admits(person({ email: "mallory@gmail.com" })).admitted, false);

    const unverified = p.admits(person({ email: "alice@gmail.com", emailVerified: false }));
    assert.equal(unverified.admitted, false);
    assert.match((unverified as { reason: string }).reason, /admitted address.*verified/);
  });

  it("lets the explicit list in even when the group claim is missing", () => {
    const p = policy({
      admitGroups: ["mica-editors"],
      admitSubjects: [{ issuer: "https://id.example.test", subject: "subject-1" }],
    });

    assert.equal(p.admits(person({ groups: [] })).admitted, true);
  });

  it("summarises what is in force, for the startup log", () => {
    const p = policy({
      admitGroups: ["mica-editors"],
      admitDomains: ["example.com"],
      admitEmails: ["alice@gmail.com", "bob@gmail.com"],
    });
    assert.match(p.summary, /group=mica-editors/);
    assert.match(p.summary, /domain=example.com/);
    // A count, not the addresses: the startup log is not a place for them.
    assert.match(p.summary, /emails=2/);
  });
});
