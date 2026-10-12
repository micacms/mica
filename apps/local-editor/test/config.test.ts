/** The local editor has no authentication: each refusal here keeps it off the network. */

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

    for (const url of ["http://localhost:6422", "http://127.0.0.1:6422"]) {
      assert.doesNotThrow(() => loadConfig({ ...base, MICA_PUBLIC_URL: url }));
    }
  });

  // The URL check does not cover the socket: a `localhost` URL can still listen on every interface.
  it("binds to loopback, and refuses to be talked out of it", () => {
    assert.equal(loadConfig({ ...base }).HOST, "127.0.0.1");

    assert.throws(() => loadConfig({ ...base, HOST: "0.0.0.0" }), /loopback/i);
    assert.throws(() => loadConfig({ ...base, HOST: "192.168.1.10" }), ConfigError);
  });

  it("publishes from the working tree by default, and can be told not to", () => {
    assert.equal(loadConfig({ ...base }).MICA_LOCAL_PUBLISH, true);
    assert.equal(loadConfig({ ...base, MICA_LOCAL_PUBLISH: "false" }).MICA_LOCAL_PUBLISH, false);
  });
});
