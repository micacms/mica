import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { emailFrom, openTransaction, sealTransaction, type OidcTransaction } from "../dist/oidc.js";

const SECRET = "0".repeat(32);
const transaction: OidcTransaction = {
  state: "s",
  nonce: "n",
  verifier: "v",
  returnTo: "/admin/",
  expiresAt: Date.now() + 60_000,
};

describe("transaction cookie", () => {
  it("round-trips, and refuses another secret", () => {
    const sealed = sealTransaction(transaction, SECRET);
    assert.deepEqual(openTransaction(sealed, SECRET), transaction);
    assert.equal(openTransaction(sealed, "1".repeat(32)), null);
  });

  it("is not signed with the session secret itself, but with a key derived from it", () => {
    const payload = Buffer.from(JSON.stringify(transaction)).toString("base64url");
    const plain = createHmac("sha256", SECRET).update(payload).digest("base64url");
    assert.equal(openTransaction(`${payload}.${plain}`, SECRET), null);
  });
});

describe("emailFrom", () => {
  it("takes the ID token's address with the ID token's flag", () => {
    assert.deepEqual(emailFrom({ email: "a@x.example", email_verified: true }), {
      email: "a@x.example",
      emailVerified: true,
    });
  });

  it("does not let userinfo vouch for a different address", () => {
    const verdict = emailFrom(
      { email: "a@x.example", email_verified: false },
      { email: "b@x.example", email_verified: true },
    );
    assert.deepEqual(verdict, { email: "a@x.example", emailVerified: false });
  });

  it("lets userinfo confirm the ID token's own address", () => {
    const verdict = emailFrom({ email: "a@x.example" }, { email: "a@x.example", email_verified: true });
    assert.deepEqual(verdict, { email: "a@x.example", emailVerified: true });
  });

  it("takes address and flag from userinfo when the ID token has no address", () => {
    assert.deepEqual(emailFrom({ email_verified: true }, { email: "b@x.example" }), {
      email: "b@x.example",
      emailVerified: false,
    });
    assert.deepEqual(emailFrom({}, { email: "b@x.example", email_verified: true }), {
      email: "b@x.example",
      emailVerified: true,
    });
  });

  it("reports no address as unverified", () => {
    assert.deepEqual(emailFrom({ email_verified: true }), { email: "", emailVerified: false });
  });
});
