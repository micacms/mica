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
