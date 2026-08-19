/**
 * Configuration.
 *
 * The tests here are all about failing early. A Mica that starts, lists the
 * editor's content and only discovers it cannot write when they press Save has
 * already cost them their work — so a repository that is named but not usable
 * has to be a startup error, not a save error.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConfigError, loadConfig } from "../src/server/config.js";

const base: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  SESSION_SECRET: "0".repeat(32),
  DATA_DIR: "/tmp/mica-test-unused",
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

    it(`refuses to start on ${provider} with a project but no token`, () => {
      assert.throws(
        () => loadConfig({ ...base, REPOSITORY: provider, REPOSITORY_PROJECT: "acme/site" }),
        /REPOSITORY_TOKEN/,
      );
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

/**
 * Local mode turns authentication off entirely, which makes these the most
 * consequential checks in the codebase. Each one is the difference between a
 * developer's convenience and an unauthenticated CMS on the internet.
 */
describe("deployment modes", () => {
  const oidc = {
    MICA_OIDC_ISSUER: "https://auth.example.com",
    MICA_OIDC_CLIENT_ID: "mica",
    MICA_ADMIT_GROUP: "mica-editors",
  };

  it("defaults to local, with authentication disabled", () => {
    const config = loadConfig({ ...base });
    assert.equal(config.MICA_MODE, "local");
    assert.equal(config.authDisabled, true);
  });

  it("refuses local mode in production", () => {
    assert.throws(
      () =>
        loadConfig({
          ...base,
          NODE_ENV: "production",
          MICA_MODE: "local",
          SESSION_SECRET: "0".repeat(32),
        }),
      /disables authentication/,
    );
  });

  it("refuses local mode on any host but this machine", () => {
    assert.throws(
      () => loadConfig({ ...base, MICA_MODE: "local", MICA_PUBLIC_URL: "https://cms.example.com" }),
      /local mode is for a developer's own machine only/i,
    );

    // ...and allows the hosts that are this machine.
    for (const url of ["http://localhost:6422", "http://127.0.0.1:6422"]) {
      assert.doesNotThrow(() => loadConfig({ ...base, MICA_MODE: "local", MICA_PUBLIC_URL: url }));
    }
  });

  /**
   * The same rule for the socket. A base URL saying `localhost` while the
   * process listens on every interface is an unauthenticated editor on the
   * network, and the URL check says nothing about it.
   */
  it("binds local mode to loopback, and refuses to be talked out of it", () => {
    assert.equal(loadConfig({ ...base }).HOST, "127.0.0.1");
    assert.equal(loadConfig({ ...base, MICA_MODE: "self-hosted", ...oidc }).HOST, "0.0.0.0");

    assert.throws(
      () => loadConfig({ ...base, MICA_MODE: "local", HOST: "0.0.0.0" }),
      /binds to the loopback address/i,
    );
  });

  it("requires an identity provider in self-hosted mode", () => {
    assert.throws(() => loadConfig({ ...base, MICA_MODE: "self-hosted" }), (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /MICA_OIDC_ISSUER and MICA_OIDC_CLIENT_ID/);
      // The message should say where to point the provider.
      assert.match(error.message, /\/api\/auth\/callback/);
      return true;
    });
  });

  it("enables authentication in self-hosted mode", () => {
    const config = loadConfig({ ...base, MICA_MODE: "self-hosted", ...oidc });
    assert.equal(config.authDisabled, false);
  });

  it("does not require a client secret, so a public PKCE client works", () => {
    assert.doesNotThrow(() => loadConfig({ ...base, MICA_MODE: "self-hosted", ...oidc }));
  });

  /**
   * Plain-HTTP discovery is allowed only for a provider on this machine, and
   * only outside production — a remote issuer over HTTP would mean handing an
   * ID token to anybody on the path.
   */
  it("permits insecure discovery only for a local provider outside production", () => {
    const local = loadConfig({
      ...base,
      MICA_MODE: "self-hosted",
      ...oidc,
      MICA_OIDC_ISSUER: "http://localhost:8080/realms/mica",
    });
    assert.equal(local.oidcAllowInsecure, true);

    const remote = loadConfig({
      ...base,
      MICA_MODE: "self-hosted",
      ...oidc,
      MICA_OIDC_ISSUER: "http://auth.example.com",
    });
    assert.equal(remote.oidcAllowInsecure, false);

    const production = loadConfig({
      ...base,
      NODE_ENV: "production",
      MICA_MODE: "self-hosted",
      MICA_PUBLIC_URL: "https://cms.example.com",
      ...oidc,
      MICA_OIDC_ISSUER: "http://localhost:8080/realms/mica",
    });
    assert.equal(production.oidcAllowInsecure, false);
  });
});

/**
 * Admission is configuration now, and configuration that is absent has to be
 * an error rather than a default. Both possible defaults are wrong: admitting
 * everybody the provider knows is a public CMS, and admitting nobody is a
 * deployment that looks fine until the first person tries to sign in.
 */
describe("who may edit", () => {
  const authenticated = {
    MICA_MODE: "self-hosted",
    MICA_OIDC_ISSUER: "https://auth.example.com",
    MICA_OIDC_CLIENT_ID: "mica",
  };

  it("refuses to start with a provider and no admission rule", () => {
    assert.throws(() => loadConfig({ ...base, ...authenticated }), (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /nothing says who may edit this site/i);
      assert.match(error.message, /MICA_ADMIT_GROUP/);
      return true;
    });
  });

  it("needs no admission rule locally, because there is nobody to admit", () => {
    assert.doesNotThrow(() => loadConfig({ ...base }));
  });

  for (const rule of [
    { MICA_ADMIT_GROUP: "mica-editors" },
    { MICA_ADMIT_DOMAIN: "example.com" },
    { MICA_ADMIT_SUBJECTS: "https://auth.example.com|a1b2c3" },
  ]) {
    it(`accepts ${Object.keys(rule)[0]} on its own`, () => {
      assert.doesNotThrow(() => loadConfig({ ...base, ...authenticated, ...rule }));
    });
  }

  it("reads all three as comma-separated lists", () => {
    const config = loadConfig({
      ...base,
      ...authenticated,
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
      () =>
        loadConfig({
          ...base,
          ...authenticated,
          MICA_ADMIT_SUBJECTS: "you@example.com",
        }),
      /issuer\|subject/,
    );
  });
});
