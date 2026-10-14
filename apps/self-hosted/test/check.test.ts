/**
 * `check` against a real Git host on loopback. It must never write to a clone
 * that a running server may use.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { after, before, describe, it } from "node:test";

import { createManifest, defineSite } from "@micacms/core/internal";
import { createLogger } from "@micacms/runtime";

import { runCheck } from "../src/check.js";
import { cloneLayout, openClone } from "../src/workspace/clone.js";
import { parseRemote } from "../src/workspace/credentials.js";
import { managedEnvironment } from "../src/workspace/isolation.js";
import { seedRepository, startGitHost, writeIn, type GitHost } from "./git-http.js";

const TOKEN = "check-token-91b2";

let host: GitHost;
before(async () => {
  host = await startGitHost(TOKEN);
  seedRepository(host, "site", {
    "content/.mica/schema.json": JSON.stringify(createManifest(defineSite({ collections: {} }), "test")),
    "content/theme.json": "{}\n",
  });
  seedRepository(host, "two-sites", {
    "one/content/.mica/schema.json": JSON.stringify(createManifest(defineSite({ collections: {} }), "test")),
    "two/content/.mica/schema.json": JSON.stringify(createManifest(defineSite({ collections: {} }), "test")),
  });
});
after(() => host.close());

function environment(dataDir: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    MICA_PUBLIC_URL: "http://localhost:6422",
    MICA_LOG_LEVEL: "silent",
    MICA_SESSION_SECRET: "0".repeat(32),
    MICA_DATA_DIR: dataDir,
    MICA_OIDC_ISSUER: "https://auth.example.com",
    MICA_OIDC_CLIENT_ID: "mica",
    MICA_ADMIT_GROUPS: "mica-editors",
    MICA_REPOSITORY_URL: host.url("site"),
    MICA_REPOSITORY_TOKEN: TOKEN,
    ...overrides,
  };
}

async function check(env: NodeJS.ProcessEnv): Promise<{ code: number; output: string }> {
  let output = "";
  const out = new Writable({
    write(chunk, _encoding, done) {
      output += String(chunk);
      done();
    },
  });
  const code = await runCheck(env, out);
  return { code, output };
}

/** Every file under `dir` with its size and modification time, to see that nothing changed. */
function snapshot(dir: string): string {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      const stat = statSync(path);
      return `${path} ${stat.size} ${stat.mtimeMs}`;
    })
    .sort()
    .join("\n");
}

describe("check", () => {
  it("passes a working setup on an empty volume", async () => {
    const { code, output } = await check(environment(mkdtempSync(join(tmpdir(), "mica-check-"))));
    assert.equal(code, 0, output);
    assert.match(output, /ok {4}read access/);
    assert.match(output, /ok {4}push rights/);
    assert.match(output, /ok {4}content root: content\n/);
    assert.match(output, /ok {4}content model/);
    assert.match(output, /no clone yet/);
  });

  it("names the failing check, without the token", async () => {
    const { code, output } = await check(
      environment(mkdtempSync(join(tmpdir(), "mica-check-")), { MICA_REPOSITORY_TOKEN: "wrong-token-77" }),
    );
    assert.equal(code, 1);
    assert.match(output, /FAIL  read access: The repository refused the token/);
    assert.ok(!output.includes("wrong-token-77"));
  });

  it("reports a configuration problem with the configuration's own exit code", async () => {
    const { code, output } = await check(environment("/tmp/unused", { MICA_REPOSITORY_URL: "" }));
    assert.equal(code, 78);
    assert.match(output, /MICA_REPOSITORY_URL is not set/);
  });

  it("needs MICA_CONTENT_PATH when the repository has more than one content root", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mica-check-"));
    const two = { MICA_REPOSITORY_URL: host.url("two-sites") };
    const { code, output } = await check(environment(dataDir, two));
    assert.equal(code, 1);
    assert.match(output, /FAIL {2}content root: .*one\/content, two\/content.*\n.*Set MICA_CONTENT_PATH/);

    const chosen = await check(environment(dataDir, { ...two, MICA_CONTENT_PATH: "two/content" }));
    assert.equal(chosen.code, 0, chosen.output);
    assert.match(chosen.output, /ok {4}content root: two\/content/);
  });

  it("writes nothing to an existing clone", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mica-check-"));
    const layout = cloneLayout(dataDir);
    const remote = parseRemote(host.url("site"));
    await openClone({
      layout,
      url: remote.url,
      branch: "main",
      root: "content",
      env: managedEnvironment({ remote, cloneDir: layout.repositoryDir, username: "mica", token: TOKEN }),
      logger: createLogger({ level: "silent", pretty: false }),
    });
    writeIn(layout.repositoryDir, "content/theme.json", '{"draft":true}\n');
    const before = snapshot(dataDir);

    const { code, output } = await check(environment(dataDir));
    assert.equal(code, 0, output);
    assert.match(output, /a clone with 1 unpublished draft files/);
    assert.equal(snapshot(dataDir), before);
    assert.equal(readFileSync(join(layout.repositoryDir, "content/theme.json"), "utf8"), '{"draft":true}\n');
  });
});
