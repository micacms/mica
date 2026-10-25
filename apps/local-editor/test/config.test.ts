/** The local editor has no authentication: each refusal here keeps it off the network. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ConfigError } from "@micacms/runtime";

import { loadConfig } from "../src/config.js";

const base: NodeJS.ProcessEnv = {
  MICA_LOG_LEVEL: "silent",
  MICA_CONTENT_ROOT: "./content",
};

describe("the local editor's containment", () => {
  // NODE_ENV is not part of the contract: only the address decides.
  it("ignores NODE_ENV", () => {
    assert.equal(loadConfig({ ...base, NODE_ENV: "production" }).HOST, "127.0.0.1");
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

  it("refuses an admin origin on another machine", () => {
    assert.throws(() => loadConfig({ ...base, MICA_ADMIN_ORIGINS: "https://evil.example" }), /MICA_ADMIN_ORIGINS/);
    assert.deepEqual(loadConfig({ ...base, MICA_ADMIN_ORIGINS: "http://localhost:5173" }).adminOrigins, ["http://localhost:5173"]);
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

  it("reads the published website's address, as the docs say", () => {
    assert.equal(loadConfig({ ...base, MICA_SITE_URL: "https://harborlane.example/" }).MICA_SITE_URL, "https://harborlane.example");
    assert.equal(loadConfig({ ...base }).MICA_SITE_URL, undefined);
  });
});
