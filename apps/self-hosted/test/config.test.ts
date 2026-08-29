/**
 * Configuration.
 *
 * The tests here are all about failing early. A Mica that starts, lists the
 * editor's content and only discovers it cannot write when they press Save has
 * already cost them their work — so a repository that is named but not usable,
 * a provider without an admission rule, and a production run without secrets
 * all have to be startup errors.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConfigError } from "@micacms/runtime";

import { loadConfig } from "../src/config.js";

/** A complete, valid self-hosted environment; tests subtract from it. */
const base: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  SESSION_SECRET: "0".repeat(32),
  DATA_DIR: "/tmp/mica-test-unused",
  MICA_OIDC_ISSUER: "https://auth.example.com",
  MICA_OIDC_CLIENT_ID: "mica",
  MICA_ADMIT_GROUP: "mica-editors",
};

describe("repository configuration", () => {
  it("defaults to a working tree on this machine", () => {
    const config = loadConfig({ ...base });
    assert.equal(config.REPOSITORY, "local");
  });

  it("does not ask a local repository for a token", () => {
    assert.doesNotThrow(() => loadConfig({ ...base, REPOSITORY: "local" }));
  });

  for (const provider of ["github", "gitlab"] as const) {
    it(`refuses to start on ${provider} without a project and a token`, () => {
      assert.throws(() => loadConfig({ ...base, REPOSITORY: provider }), (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /REPOSITORY_PROJECT and REPOSITORY_TOKEN/);
        return true;
      });
    });

    it(`accepts ${provider} once both are given`, () => {
      const config = loadConfig({
        ...base,
        REPOSITORY: provider,
        REPOSITORY_PROJECT: "acme/site",
        REPOSITORY_TOKEN: "secret",
      });

      assert.equal(config.REPOSITORY, provider);
      // The defaults that keep a token away from the website's source code.
      assert.equal(config.REPOSITORY_ROOT, "content");
      assert.equal(config.REPOSITORY_BRANCH, "main");
    });
  }

  it("rejects a repository mode it has no connector for", () => {
    assert.throws(() => loadConfig({ ...base, REPOSITORY: "subversion" }), ConfigError);
  });
});

describe("authentication", () => {
  it("binds every interface by default — a container has to", () => {
    assert.equal(loadConfig({ ...base }).HOST, "0.0.0.0");
  });

  it("requires an identity provider", () => {
    const withoutOidc = { ...base };
    delete withoutOidc["MICA_OIDC_ISSUER"];
    delete withoutOidc["MICA_OIDC_CLIENT_ID"];

    assert.throws(() => loadConfig(withoutOidc), (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /MICA_OIDC_ISSUER and MICA_OIDC_CLIENT_ID/);
      // The message should say where to point the provider.
      assert.match(error.message, /\/api\/auth\/callback/);
      return true;
    });
  });

  it("does not require a client secret, so a public PKCE client works", () => {
    assert.doesNotThrow(() => loadConfig({ ...base }));
  });

  it("requires the session secret in production", () => {
    const production: NodeJS.ProcessEnv = {
      ...base,
      NODE_ENV: "production",
      MICA_PUBLIC_URL: "https://cms.example.com",
    };
    delete production["SESSION_SECRET"];

    assert.throws(() => loadConfig(production), /SESSION_SECRET/);
  });

  it("generates an ephemeral secret outside production, and says so", () => {
    const dev = { ...base };
    delete dev["SESSION_SECRET"];

    const config = loadConfig(dev);
    assert.equal(config.sessionSecret.length >= 32, true);
    assert.deepEqual(config.devSecrets, ["SESSION_SECRET"]);
  });

  /**
   * Plain-HTTP discovery is allowed only for a provider on this machine, and
   * only outside production — a remote issuer over HTTP would mean handing an
   * ID token to anybody on the path.
   */
  it("permits insecure discovery only for a local provider outside production", () => {
    const local = loadConfig({
      ...base,
      MICA_OIDC_ISSUER: "http://localhost:8080/realms/mica",
    });
    assert.equal(local.oidcAllowInsecure, true);

    const remote = loadConfig({ ...base, MICA_OIDC_ISSUER: "http://auth.example.com" });
    assert.equal(remote.oidcAllowInsecure, false);

    const production = loadConfig({
      ...base,
      NODE_ENV: "production",
      MICA_PUBLIC_URL: "https://cms.example.com",
      MICA_OIDC_ISSUER: "http://localhost:8080/realms/mica",
    });
    assert.equal(production.oidcAllowInsecure, false);
  });
});

/**
 * Admission is configuration, and configuration that is absent has to be an
 * error rather than a default. Both possible defaults are wrong: admitting
 * everybody the provider knows is a public CMS, and admitting nobody is a
 * deployment that looks fine until the first person tries to sign in.
 */
describe("who may edit", () => {
  const withoutRules = () => {
    const env = { ...base };
    delete env["MICA_ADMIT_GROUP"];
    return env;
  };

  it("refuses to start with a provider and no admission rule", () => {
    assert.throws(() => loadConfig(withoutRules()), (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /nothing says who may edit this site/i);
      assert.match(error.message, /MICA_ADMIT_GROUP/);
      return true;
    });
  });

  for (const rule of [
    { MICA_ADMIT_GROUP: "mica-editors" },
    { MICA_ADMIT_DOMAIN: "example.com" },
    { MICA_ADMIT_SUBJECTS: "https://auth.example.com|a1b2c3" },
  ]) {
    it(`accepts ${Object.keys(rule)[0]} on its own`, () => {
      assert.doesNotThrow(() => loadConfig({ ...withoutRules(), ...rule }));
    });
  }

  it("reads all three as comma-separated lists", () => {
    const config = loadConfig({
      ...base,
      MICA_ADMIT_GROUP: "editors, writers",
      MICA_ADMIT_DOMAIN: "Example.com, @acme.test",
      MICA_ADMIT_SUBJECTS: "https://a.test|one, https://b.test|two",
    });

    assert.deepEqual(config.admitGroups, ["editors", "writers"]);
    // Lowercased, and an `@` the operator typed out of habit is not part of it.
    assert.deepEqual(config.admitDomains, ["example.com", "acme.test"]);
    assert.deepEqual(config.admitSubjects, [
      { issuer: "https://a.test", subject: "one" },
      { issuer: "https://b.test", subject: "two" },
    ]);
  });

  /**
   * A subject list keyed on an email address would rebind access to whoever
   * holds that address today, which is how account takeover happens. Refusing
   * the shape is how an operator finds that out at startup rather than never.
   */
  it("refuses a subject that is not keyed by issuer", () => {
    assert.throws(
      () => loadConfig({ ...base, MICA_ADMIT_SUBJECTS: "you@example.com" }),
      /issuer\|subject/,
    );
  });
});
