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
    OIDC_ISSUER: "https://auth.example.com",
    OIDC_CLIENT_ID: "mica",
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
      () => loadConfig({ ...base, MICA_MODE: "local", CMS_BASE_URL: "https://cms.example.com" }),
      /local mode is for a developer's own machine only/i,
    );

    // ...and allows the hosts that are this machine.
    for (const url of ["http://localhost:4000", "http://127.0.0.1:4000"]) {
      assert.doesNotThrow(() => loadConfig({ ...base, MICA_MODE: "local", CMS_BASE_URL: url }));
    }
  });

  for (const mode of ["self-hosted", "cloud"] as const) {
    it(`requires an identity provider in ${mode} mode`, () => {
      assert.throws(() => loadConfig({ ...base, MICA_MODE: mode }), (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /OIDC_ISSUER and OIDC_CLIENT_ID/);
        // The message should say where to point the provider.
        assert.match(error.message, /\/api\/auth\/callback/);
        return true;
      });
    });

    it(`enables authentication in ${mode} mode`, () => {
      const config = loadConfig({ ...base, MICA_MODE: mode, ...oidc });
      assert.equal(config.authDisabled, false);
    });
  }

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
      OIDC_ISSUER: "http://localhost:8080/realms/mica",
      OIDC_CLIENT_ID: "mica",
    });
    assert.equal(local.oidcAllowInsecure, true);

    const remote = loadConfig({
      ...base,
      MICA_MODE: "self-hosted",
      OIDC_ISSUER: "http://auth.example.com",
      OIDC_CLIENT_ID: "mica",
    });
    assert.equal(remote.oidcAllowInsecure, false);

    const production = loadConfig({
      ...base,
      NODE_ENV: "production",
      MICA_MODE: "self-hosted",
      CMS_BASE_URL: "https://cms.example.com",
      MICA_SCHEMA: "/app/schema.json",
      OIDC_ISSUER: "http://localhost:8080/realms/mica",
      OIDC_CLIENT_ID: "mica",
    });
    assert.equal(production.oidcAllowInsecure, false);
  });
});
