/**
 * The local editor's configuration.
 *
 * These are the most consequential checks in the codebase: the local editor
 * has no authentication at all, and each refusal here is the difference
 * between a developer's convenience and an unauthenticated CMS on a network.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConfigError } from "@micacms/runtime";

import { loadConfig } from "../src/config.js";

const base: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
};

describe("the local editor's containment", () => {
  it("is refused outright in production", () => {
    assert.throws(
      () => loadConfig({ ...base, NODE_ENV: "production" }),
      /no authentication/i,
    );
  });

  it("refuses any public URL that is not this machine", () => {
    assert.throws(
      () => loadConfig({ ...base, MICA_PUBLIC_URL: "https://cms.example.com" }),
      /developer's own machine/i,
    );

    // ...and allows the hosts that are this machine.
    for (const url of ["http://localhost:6422", "http://127.0.0.1:6422"]) {
      assert.doesNotThrow(() => loadConfig({ ...base, MICA_PUBLIC_URL: url }));
    }
  });

  /**
   * The same rule for the socket. A base URL saying `localhost` while the
   * process listens on every interface is an unauthenticated editor on the
   * network, and the URL check says nothing about it.
   */
  it("binds to loopback, and refuses to be talked out of it", () => {
    assert.equal(loadConfig({ ...base }).HOST, "127.0.0.1");

    assert.throws(() => loadConfig({ ...base, HOST: "0.0.0.0" }), /loopback/i);
    assert.throws(() => loadConfig({ ...base, HOST: "192.168.1.10" }), ConfigError);
  });

  it("has no repository mode to configure: it edits a checkout", () => {
    const config = loadConfig({ ...base });
    assert.equal(config.REPOSITORY, "local");
    // A provider variable in the environment changes nothing here — the
    // schema never reads it, which is a stronger statement than refusing it.
    assert.equal(loadConfig({ ...base, REPOSITORY: "github" }).REPOSITORY, "local");
  });

  it("publishes from the working tree by default, and can be told not to", () => {
    assert.equal(loadConfig({ ...base }).MICA_LOCAL_PUBLISH, true);
    assert.equal(loadConfig({ ...base, MICA_LOCAL_PUBLISH: "false" }).MICA_LOCAL_PUBLISH, false);
  });
});
