/**
 * The front door: `npx @micacms/cms`.
 *
 * Argument handling is tested in-process; everything that ends in
 * `process.exit` is tested by running the real command, because an exit code
 * and a message on stderr are the whole contract a CLI has with a person and
 * with the shell around it.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { MANIFEST_PATH } from "@micacms/model";

import { cacheDir, parse } from "../src/server/cli.js";

const CLI = path.resolve(import.meta.dirname, "../src/server/cli.ts");

/**
 * The command as a shell runs it, through tsx so the sources are the truth.
 *
 * `tsx` is resolved from here rather than named: the command runs with its cwd
 * inside a temporary project, where nothing would resolve a bare specifier.
 */
const TSX = import.meta.resolve("tsx");

function run(args: string[], cwd = tmpdir()) {
  return spawnSync(process.execPath, ["--import", TSX, CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: "" },
  });
}

describe("arguments", () => {
  it("defaults to ./content", () => {
    assert.equal(parse([]).content, "./content");
  });

  it("takes the content root from a flag or from a bare path", () => {
    assert.equal(parse(["--content", "./site/content"]).content, "./site/content");
    assert.equal(parse(["-c", "./site/content"]).content, "./site/content");
    assert.equal(parse(["./site/content"]).content, "./site/content");
  });

  it("takes a port, a host and a data directory", () => {
    const options = parse(["-p", "4321", "--host", "0.0.0.0", "--data", "./tmp"]);

    assert.equal(options.port, "4321");
    assert.equal(options.host, "0.0.0.0");
    assert.equal(options.data, "./tmp");
  });
});

describe("where the database goes", () => {
  it("is outside the project, because local mode has nothing worth keeping", () => {
    const directory = cacheDir("/home/dev/site/content");

    assert.ok(!directory.startsWith("/home/dev/site/content"), directory);
    assert.match(directory, /mica/);
  });

  it("differs per project, so two checkouts do not share accounts", () => {
    assert.notEqual(cacheDir("/a/content"), cacheDir("/b/content"));
    assert.equal(cacheDir("/a/content"), cacheDir("/a/content"));
  });
});

describe("running it", () => {
  it("explains itself and exits cleanly", () => {
    const result = run(["--help"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /--content/);
    assert.match(result.stdout, /Authentication is DISABLED/);
  });

  it("prints its version", () => {
    const result = run(["--version"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
  });

  it("refuses an option it does not know", () => {
    const result = run(["--reposit0ry", "github"]);

    assert.equal(result.status, 64, "EX_USAGE");
    assert.match(result.stderr, /Unknown option/);
  });

  it("names the directory it could not find", () => {
    const result = run(["--content", "./definitely-not-here"]);

    assert.equal(result.status, 64);
    assert.match(result.stderr, /definitely-not-here/);
  });

  it("says how to publish a model when the project has not", () => {
    const project = mkdtempSync(path.join(tmpdir(), "mica-cli-"));
    mkdirSync(path.join(project, "content"));

    const result = run([], project);

    assert.equal(result.status, 78, "EX_CONFIG");
    assert.match(result.stderr, /No content model/);
    // The fix is in the Astro project, not in Mica's configuration.
    assert.match(result.stderr, /astro build/);
  });

  it("gets past its own checks once the model is published", () => {
    const project = mkdtempSync(path.join(tmpdir(), "mica-cli-"));
    mkdirSync(path.join(project, "content", path.dirname(MANIFEST_PATH)), { recursive: true });
    writeFileSync(path.join(project, "content", MANIFEST_PATH), "{ truncated");

    const result = run([], project);

    // From here the server takes over: it reports the broken model itself,
    // which is what proves the CLI hands off rather than duplicating the checks.
    assert.equal(result.status, 78);
    assert.match(result.stderr, /not valid JSON/);
  });
});
