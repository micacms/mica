/**
 * `check` against a real Git host on loopback. It must never write to a clone
 * that a running server may use.
 */

import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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
/** An identity provider that answers discovery only. */
let issuer: { url: string; close(): void };
before(async () => {
  host = await startGitHost(TOKEN);
  const server = createServer((req, res) => {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    if (req.url !== "/.well-known/openid-configuration") return void res.writeHead(404).end();
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ issuer: url, authorization_endpoint: `${url}/auth`, token_endpoint: `${url}/token`, jwks_uri: `${url}/jwks` }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
  seedRepository(host, "site", {
    "content/.mica/schema.json": JSON.stringify(createManifest(defineSite({ collections: {} }), "test")),
    "content/theme.json": "{}\n",
  });
  seedRepository(host, "two-sites", {
    "one/content/.mica/schema.json": JSON.stringify(createManifest(defineSite({ collections: {} }), "test")),
    "two/content/.mica/schema.json": JSON.stringify(createManifest(defineSite({ collections: {} }), "test")),
  });
});
after(() => {
  host.close();
  issuer.close();
});

function environment(dataDir: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    MICA_PUBLIC_URL: "http://localhost:6422",
    MICA_LOG_LEVEL: "silent",
    MICA_SESSION_SECRET: "0".repeat(32),
    MICA_DATA_DIR: dataDir,
    MICA_OIDC_ISSUER: issuer.url,
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
    assert.match(output, /ok {4}identity provider: http:\/\/127\.0\.0\.1:\d+ answers\. Register the redirect URI http:\/\/localhost:6422\/api\/auth\/callback/);
    assert.match(output, /ok {4}content root: content\n/);
    assert.match(output, /ok {4}data volume: writable, no clone yet/);
    assert.match(output, /ok {4}content model/);
    assert.match(output, /ok {4}Git LFS: not used under the content root/);
    assert.match(output, /no clone yet/);
  });

  it("names the .gitattributes file that gives the content root to Git LFS", async () => {
    seedRepository(host, "with-lfs", {
      "content/.mica/schema.json": JSON.stringify(createManifest(defineSite({ collections: {} }), "test")),
      "content/.gitattributes": "*.jpg filter=lfs diff=lfs merge=lfs -text\n",
    });
    const { output } = await check(
      environment(mkdtempSync(join(tmpdir(), "mica-check-")), { MICA_REPOSITORY_URL: host.url("with-lfs") }),
    );
    assert.match(output, /(ok|FAIL) {2,4}Git LFS: content\/\.gitattributes assigns LFS under the content root/);
  });

  it("refuses a Git LFS URL that is not HTTPS", async () => {
    const { code, output } = await check(
      environment(mkdtempSync(join(tmpdir(), "mica-check-")), { MICA_REPOSITORY_LFS_URL: "ftp://example.com/lfs" }),
    );
    assert.equal(code, 78);
    assert.match(output, /MICA_REPOSITORY_LFS_URL must be an https:\/\/ URL/);
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

  it("fails for an identity provider that does not answer, and for a volume it cannot write", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mica-check-"));
    chmodSync(dataDir, 0o500);
    try {
      const { code, output } = await check(environment(dataDir, { MICA_OIDC_ISSUER: `${issuer.url}/missing` }));
      assert.equal(code, 1);
      assert.match(output, /FAIL {2}identity provider: .*\/missing cannot be discovered/);
      assert.match(output, /FAIL {2}data volume: .* is not writable/);
    } finally {
      chmodSync(dataDir, 0o700);
    }
  });

  it("refuses a volume with another layout version", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mica-check-"));
    writeFileSync(join(dataDir, "volume.json"), '{"version":2}');
    const { code, output } = await check(environment(dataDir));
    assert.equal(code, 1);
    assert.match(output, /FAIL {2}data volume: layout version 2/);
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
    assert.match(output, /a clone at [0-9a-f]+, with 1 unpublished draft files/);
    assert.equal(snapshot(dataDir), before);
    assert.equal(readFileSync(join(layout.repositoryDir, "content/theme.json"), "utf8"), '{"draft":true}\n');
  });
});
