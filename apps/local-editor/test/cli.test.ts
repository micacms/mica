/**
 * The front door: `npx @micacms/editor`.
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

import { MANIFEST_PATH } from "@micacms/core/internal";

import { DEFAULT_PORT } from "@micacms/runtime";

import { contentRoot, contentRootsUnder, parse, serverEnvironment, shouldOpenBrowser } from "../src/cli.js";

const CLI = path.resolve(import.meta.dirname, "../src/cli.ts");

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
  it("leaves the content root open when no path is given", () => {
    assert.equal(parse([]).content, undefined);
  });

  it("takes the content root from the path, else MICA_CONTENT_ROOT, else the model, else ./content", () => {
    const project = mkdtempSync(path.join(tmpdir(), "mica-root-"));
    const env = { MICA_CONTENT_ROOT: "/from/env" };
    // Resolved against the project: on Windows, a path without a drive takes the project's drive.
    assert.equal(contentRoot({ content: "/from/flag" }, env, project), path.resolve(project, "/from/flag"));
    assert.equal(contentRoot({}, env, project), path.resolve(project, "/from/env"));
    assert.equal(contentRoot({}, { MICA_CONTENT_ROOT: "" }, project), path.join(project, "content"));

    for (const dir of ["site/data/.mica", "node_modules/x/.mica", ".astro/.mica"]) mkdirSync(path.join(project, dir), { recursive: true });
    writeFileSync(path.join(project, "site/data/.mica/schema.json"), "{}");
    writeFileSync(path.join(project, "node_modules/x/.mica/schema.json"), "{}");
    writeFileSync(path.join(project, ".astro/.mica/schema.json"), "{}");
    assert.equal(contentRoot({}, {}, project), path.join(project, "site/data"));

    mkdirSync(path.join(project, "other/.mica"), { recursive: true });
    writeFileSync(path.join(project, "other/.mica/schema.json"), "{}");
    assert.deepEqual(contentRootsUnder(project).sort(), [path.join(project, "other"), path.join(project, "site/data")]);
  });

  it("lets a flag win over the environment, and the environment over a default", () => {
    const env = { PORT: "3000", HOST: "localhost", MICA_PUBLIC_URL: "http://localhost:3000" };
    const flagged = serverEnvironment({ port: "7000", open: false }, env, "/site/content");
    assert.equal(flagged["PORT"], "7000");
    assert.equal(flagged["MICA_PUBLIC_URL"], "http://localhost:7000");
    assert.equal(flagged["HOST"], "localhost");
    assert.equal(flagged["MICA_CONTENT_ROOT"], "/site/content");

    const blank = serverEnvironment({ open: false }, { PORT: " ", MICA_PUBLIC_URL: "" }, "/site/content");
    assert.equal(blank["PORT"], String(DEFAULT_PORT));
    assert.equal(blank["MICA_PUBLIC_URL"], `http://localhost:${DEFAULT_PORT}`);

    const plain = serverEnvironment({ open: false }, {}, "/site/content");
    assert.equal(plain["PORT"], String(DEFAULT_PORT));
    assert.equal(plain["HOST"], "127.0.0.1");
    assert.equal(plain["MICA_PUBLIC_URL"], `http://localhost:${DEFAULT_PORT}`);
  });

  it("takes the import options, and the content root as a bare path there too", () => {
    const options = parse(["./site/content", "--collection", "news", "--collection", "team", "--map", "news.cover.alt=alt", "--order", "team=order", "--from", "store.json"], "import");
    assert.equal(options.content, "./site/content");
    assert.deepEqual(options.collections, ["news", "team"]);
    assert.deepEqual(options.map, { "news.cover.alt": "alt" });
    assert.deepEqual(options.order, { team: "order" });
    assert.equal(options.from, "store.json");
  });

  it("takes the content root from a flag or from a bare path", () => {
    assert.equal(parse(["--content", "./site/content"]).content, "./site/content");
    assert.equal(parse(["-c", "./site/content"]).content, "./site/content");
    assert.equal(parse(["./site/content"]).content, "./site/content");
  });

  it("takes a port and a host", () => {
    const options = parse(["-p", "4321", "--host", "0.0.0.0"]);

    assert.equal(options.port, "4321");
    assert.equal(options.host, "0.0.0.0");
  });

  it("takes an explicit answer about the browser, and otherwise has none", () => {
    assert.equal(parse([]).open, undefined);
    assert.equal(parse(["--open"]).open, true);
    assert.equal(parse(["--no-open"]).open, false);
  });

  it("takes --preview for start only", () => {
    assert.equal(parse([]).preview, undefined);
    assert.equal(parse(["--preview"]).preview, true);
  });
});

describe("opening a browser", () => {
  const options = (open?: boolean) => ({ content: "./content", ...(open === undefined ? {} : { open }) });

  it("is for a person at a terminal, not for a script or a CI job", () => {
    // `shouldOpenBrowser` reads the real stdout for interactivity, which is not
    // a terminal under the test runner — the same answer a pipe would get.
    assert.equal(shouldOpenBrowser(options(), {}), false);
    assert.equal(shouldOpenBrowser(options(), { CI: "true" }), false);
  });

  it("does what it was told, whatever the terminal looks like", () => {
    assert.equal(shouldOpenBrowser(options(true), { CI: "true" }), true);
    assert.equal(shouldOpenBrowser(options(false), {}), false);
  });
});

describe("running it", () => {
  it("explains itself and exits cleanly", () => {
    const result = run(["--help"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /--content/);
    // The port is one number in one place, and the help is one of its readers.
    assert.match(result.stdout, new RegExp(String(DEFAULT_PORT)));
    // Nobody should have to deduce that this mode has no authentication.
    assert.match(result.stdout, /no sign-in here/i);
  });

  it("prints the help without a command, and refuses a word that is no command", () => {
    const help = run([]);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /npx mica start/);

    // A directory named like a command must not run it: a path needs `start`.
    const word = run(["./site"]);
    assert.equal(word.status, 64);
    assert.match(word.stderr, /Unknown command "\.\/site"\. To open the editor: npx mica start/);
  });

  it("prints its version", () => {
    const result = run(["--version"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
  });

  it("refuses an option it does not know", () => {
    const result = run(["start", "--reposit0ry", "github"]);

    assert.equal(result.status, 64, "EX_USAGE");
    assert.match(result.stderr, /Unknown option/);
  });

  it("names the directory it could not find", () => {
    const result = run(["start", "--content", "./definitely-not-here"]);

    assert.equal(result.status, 64);
    assert.match(result.stderr, /definitely-not-here/);
    // And says what that directory is, rather than only that it is missing.
    assert.match(result.stderr, /npx mica start \.\/path\/to\/content/);
  });

  it("says how to publish a model when the project has not", () => {
    const project = mkdtempSync(path.join(tmpdir(), "mica-cli-"));
    mkdirSync(path.join(project, "content"));

    const result = run(["start"], project);

    assert.equal(result.status, 78, "EX_CONFIG");
    assert.match(result.stderr, /no content model/i);
    // The fix is in the Astro project, not in Mica's configuration.
    assert.match(result.stderr, /astro sync/);
  });

  it("refuses an option of another command, and a second content directory", () => {
    const port = run(["check", "--port", "4321"]);
    assert.equal(port.status, 64);
    assert.match(port.stderr, /check has no option --port/);

    const two = run(["check", "./a", "./b"]);
    assert.equal(two.status, 64);
    assert.match(two.stderr, /one content directory/);
  });

  it("answers a missing model with exit 78 and a message, in check and import", () => {
    const project = mkdtempSync(path.join(tmpdir(), "mica-cli-"));
    mkdirSync(path.join(project, "content"));

    const check = run(["check"], project);
    assert.equal(check.status, 78);
    assert.match(check.stdout, /Could not read the content model/);

    const imported = run(["import"], project);
    assert.equal(imported.status, 78);
    assert.match(imported.stderr, /npx astro sync/);
    assert.doesNotMatch(imported.stderr, /    at /);
  });

  it("names the missing Astro project for --preview", () => {
    const project = mkdtempSync(path.join(tmpdir(), "mica-cli-"));
    mkdirSync(path.join(project, "content", path.dirname(MANIFEST_PATH)), { recursive: true });
    writeFileSync(path.join(project, "content", MANIFEST_PATH), "{}");

    const result = run(["start", "--preview"], project);

    assert.equal(result.status, 78);
    assert.match(result.stderr, /no Astro project at or above/);
    assert.match(run(["check", "--preview"], project).stderr, /check has no option --preview/);
  });

  it("gets past its own checks once the model is published", () => {
    const project = mkdtempSync(path.join(tmpdir(), "mica-cli-"));
    mkdirSync(path.join(project, "content", path.dirname(MANIFEST_PATH)), { recursive: true });
    writeFileSync(path.join(project, "content", MANIFEST_PATH), "{ truncated");

    const result = run(["start"], project);

    // From here the server takes over: it reports the broken model itself,
    // which is what proves the CLI hands off rather than duplicating the checks.
    assert.equal(result.status, 78);
    assert.match(result.stderr, /not valid JSON/);
  });
});
