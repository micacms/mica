/**
 * `compact` against a real Git host on loopback: a new clone, but only without
 * unpublished work.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { after, before, describe, it } from "node:test";

import { createLogger } from "@micacms/runtime";

import { runCompact } from "../src/compact.js";
import { cloneLayout, openClone } from "../src/workspace/clone.js";
import { parseRemote } from "../src/workspace/credentials.js";
import { managedEnvironment } from "../src/workspace/isolation.js";
import { devGit, seedRepository, startGitHost, writeIn, type GitHost } from "./git-http.js";

const TOKEN = "compact-token-5c1e";

let host: GitHost;
before(async () => {
  host = await startGitHost(TOKEN);
  seedRepository(host, "site", { "content/.mica/schema.json": '{"protocolVersion":1}\n', "content/theme.json": "{}\n" });
});
after(() => host.close());

async function compact(dataDir: string): Promise<{ code: number; output: string }> {
  let output = "";
  const out = new Writable({
    write(chunk, _encoding, done) {
      output += String(chunk);
      done();
    },
  });
  const code = await runCompact(
    {
      MICA_PUBLIC_URL: "http://localhost:6422",
      MICA_LOG_LEVEL: "silent",
      MICA_SESSION_SECRET: "0".repeat(32),
      MICA_DATA_DIR: dataDir,
      MICA_OIDC_ISSUER: "https://auth.example.com",
      MICA_OIDC_CLIENT_ID: "mica",
      MICA_ADMIT_GROUPS: "mica-editors",
      MICA_REPOSITORY_URL: host.url("site"),
      MICA_REPOSITORY_TOKEN: TOKEN,
    },
    out,
  );
  return { code, output };
}

async function cloneInto(dataDir: string): Promise<string> {
  const layout = cloneLayout(dataDir);
  const remote = parseRemote(host.url("site"));
  await openClone({
    layout,
    url: remote.url,
    branch: "main",
    root: null,
    env: managedEnvironment({ remote, cloneDir: layout.repositoryDir, username: "mica", token: TOKEN }),
    logger: createLogger({ level: "silent", pretty: false }),
  });
  return layout.repositoryDir;
}

describe("compact", () => {
  it("clones again when the clone holds no work", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mica-compact-"));
    const repo = await cloneInto(dataDir);
    const marker = join(repo, ".git", "mica-old-clone");
    writeIn(repo, ".git/mica-old-clone", "x");

    const { code, output } = await compact(dataDir);
    assert.equal(code, 0, output);
    assert.match(output, /Compacted the clone: [\d.]+ MB before, [\d.]+ MB now\./);
    assert.equal(existsSync(marker), false);
    assert.equal(devGit(repo, "rev-parse", "--abbrev-ref", "HEAD"), "main");
    assert.equal(existsSync(join(dataDir, "lease.json")), false);
  });

  it("refuses a clone with drafts, and leaves it as it is", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mica-compact-"));
    const repo = await cloneInto(dataDir);
    writeIn(repo, "content/theme.json", '{"draft":true}\n');

    const { code, output } = await compact(dataDir);
    assert.equal(code, 1);
    assert.match(output, /work that is not published \(1 draft files\)/);
    assert.equal(devGit(repo, "status", "--porcelain"), "M content/theme.json");
  });

  it("does nothing without a clone", async () => {
    const { code, output } = await compact(mkdtempSync(join(tmpdir(), "mica-compact-")));
    assert.equal(code, 0);
    assert.match(output, /no clone on the data volume/);
  });
});
