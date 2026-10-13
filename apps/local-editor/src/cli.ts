#!/usr/bin/env node
/**
 * `npx @micacms/editor` — Mica against a project on this machine.
 *
 * The point of this file is that adopting Mica should not mean adopting this
 * repository. Everything it does is set environment variables and hand over to
 * the same entry point a container runs, so there is one server with one
 * configuration path and this is a front door rather than a second one.
 *
 * Two defaults differ from a container's, and both are deliberate:
 *
 *   - it binds to loopback. A container binds 0.0.0.0 because it has to; a
 *     laptop does not, and this editor has no authentication. Anything
 *     reachable by anyone else runs @micacms/self-hosted with an identity
 *     provider — see https://micacms.com/docs/self-hosting/.
 *   - it talks to a person instead of to a log collector: one short banner
 *     saying where the editor is and what happens when you save, and the
 *     browser opened on it. `MICA_CLI` is how the server is told which of the
 *     two audiences it has.
 *
 * There is no state to keep anywhere: the local editor has no database, no
 * account and no session, so nothing is written outside the content
 * directory.
 *
 * A flag wins over the environment, and the environment over a default. No
 * `.env` file is read: the project's `.env` belongs to the site.
 */

import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { MANIFEST_PATH } from "@micacms/core";
import { DEFAULT_PORT, VERSION } from "@micacms/runtime";

import { checkContent, formatReport } from "./check.js";
import { formatInit, initProject, InitError } from "./init.js";
import { formatMigration, migrateLayout } from "./migrate.js";

export interface Options {
  /** Undefined means "not given": `MICA_CONTENT_ROOT`, else `./content`. */
  content?: string;
  port?: string;
  host?: string;
  /** Undefined means "decide from the terminal" — see `shouldOpenBrowser`. */
  open?: boolean;
}

const USAGE = `
  mica — edit your Astro project's content, on this machine

  Usage
    $ npx @micacms/editor [content directory]   open the editor
    $ npx @micacms/editor init                  add Mica to this Astro project
    $ npx @micacms/editor check [content dir]   check every entry against the model
    $ npx @micacms/editor migrate-layout [dir]  move entries into the layout of the model

  With @micacms/editor installed in the project, \`npx mica\` is the same command.

  Options
    -c, --content <dir>   The content root (default: ./content)
    -p, --port <number>   Port to listen on (default: ${DEFAULT_PORT})
        --host <address>  Address to bind (default: 127.0.0.1)
        --no-open         Do not open the browser
    -h, --help            Show this
    -v, --version         Print the version

  There is no sign-in here, because there is nothing to sign in to: this mode
  has no identity provider, no account and no user. That is right for your own
  machine and wrong everywhere else — a Mica other people reach runs as a
  container with an identity provider. See https://micacms.com/docs/self-hosting/.
`;

export function parse(argv: string[]): Options {
  const options: Options = {};

  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]!;
    const value = (): string => {
      const next = argv[++index];
      if (next === undefined || next.startsWith("-")) fail(`${flag} needs a value.`);
      return next!;
    };

    switch (flag) {
      case "-c":
      case "--content":
        options.content = value();
        break;
      case "-p":
      case "--port":
        options.port = value();
        break;
      case "--host":
        options.host = value();
        break;
      case "--open":
        options.open = true;
        break;
      case "--no-open":
        options.open = false;
        break;
      case "-h":
      case "--help":
        process.stdout.write(`${USAGE}\n`);
        process.exit(0);

      case "-v":
      case "--version":
        process.stdout.write(`${VERSION}\n`);
        process.exit(0);

      default:
        // A bare path is the content root, so `npx @micacms/editor ./site/content`
        // does what it looks like it does.
        if (!flag.startsWith("-")) options.content = flag;
        else fail(`Unknown option "${flag}".`);
    }
  }

  return options;
}

/**
 * A problem the person can fix, said the way a person reads.
 *
 * The title is the fact, the lines under it are what to do about it. Anything
 * printed here has already decided the command is over: the caller exits.
 */
function report(title: string, lines: string[]): void {
  const body = lines.map((line) => (line ? `  ${line}` : "")).join("\n");
  process.stderr.write(`\n  ${title}\n\n${body}\n\n`);
}

function fail(message: string): never {
  report(message, ["Run `npx @micacms/editor --help` to see every option."]);
  process.exit(64); // EX_USAGE
}

/**
 * Opening a browser is a courtesy, so it is offered only where it can be
 * welcome: an interactive terminal that somebody is sitting at. A script, a
 * container and a CI job all get a server and no surprises.
 */
export function shouldOpenBrowser(options: Options, env: NodeJS.ProcessEnv): boolean {
  if (options.open !== undefined) return options.open;
  return Boolean(process.stdout.isTTY) && !env["CI"];
}

/** A variable's value, with a blank one counted as not set. */
const set = (value: string | undefined): string | undefined => (value?.trim() ? value : undefined);

/** The content root: the flag or path, else `MICA_CONTENT_ROOT`, else `./content`. */
export function contentRoot(options: Options, env: NodeJS.ProcessEnv): string {
  return path.resolve(options.content ?? set(env["MICA_CONTENT_ROOT"]) ?? "./content");
}

/** What the server reads: a flag wins over the environment, and the environment over a default. */
export function serverEnvironment(options: Options, env: NodeJS.ProcessEnv, content: string): Record<string, string> {
  const port = options.port ?? set(env["PORT"]) ?? String(DEFAULT_PORT);
  return {
    // The checks ran on this path, so it is the one the server gets.
    MICA_CONTENT_ROOT: content,
    HOST: options.host ?? set(env["HOST"]) ?? "127.0.0.1",
    PORT: port,
    // It must agree with the port: it scopes the cookie and the Origin check.
    MICA_PUBLIC_URL: (!options.port && set(env["MICA_PUBLIC_URL"])) || `http://localhost:${port}`,
    // A person, not a log collector: one banner instead of startup log lines.
    MICA_CLI: "true",
    MICA_OPEN: String(shouldOpenBrowser(options, env)),
  };
}

export async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "init") return init(rest);
  if (command === "check") return check(rest);
  if (command === "migrate-layout") return migrate(rest);

  const options = parse(process.argv.slice(2));
  const content = contentRoot(options, process.env);

  if (!existsSync(content)) {
    report(`There is no content directory at ${content}.`, [
      "Mica edits the directory your Astro project publishes content into —",
      "the `root` in your `defineSite({ root: \"./content\" })`.",
      "",
      "  npx @micacms/editor ./path/to/content",
      "",
      "If this is a new project, create the directory and Mica writes the first",
      "entry into it.",
    ]);
    process.exit(64); // EX_USAGE
  }

  // A far more useful message than the server's, because here we know the
  // project is on this machine and can name the command that fixes it.
  if (!existsSync(path.join(content, MANIFEST_PATH))) {
    report(`There is no content model at ${path.join(content, MANIFEST_PATH)}.`, [
      "Mica ships without one: your Astro project defines the model, and building",
      "the project writes it there. Run this in the project, then start Mica again:",
      "",
      "  npx astro sync         # or build, or start the dev server once",
      "",
      "If you have not defined a model yet, run `npx @micacms/editor init`, or see",
      "https://micacms.com/docs/getting-started/.",
    ]);
    process.exit(78); // EX_CONFIG
  }

  Object.assign(process.env, serverEnvironment(options, process.env, content));

  // The server is imported rather than spawned: one process, one signal
  // handler, and a stack trace that points at the real thing.
  await import("./index.js");
}

function init(argv: string[]): void {
  if (argv.length > 0) fail(`init takes no options; it works in the current directory.`);
  try {
    process.stdout.write(formatInit(initProject(process.cwd())));
  } catch (error) {
    if (!(error instanceof InitError)) throw error;
    report(error.message, []);
    process.exit(64); // EX_USAGE
  }
}

async function check(argv: string[]): Promise<void> {
  const root = contentRoot(parse(argv), process.env);
  const result = await checkContent(root);
  process.stdout.write(formatReport(result, root));
  if (result.problems.some((problem) => problem.level === "error")) process.exit(1);
}

async function migrate(argv: string[]): Promise<void> {
  const result = await migrateLayout(contentRoot(parse(argv), process.env));
  process.stdout.write(formatMigration(result));
  if (result.conflicts.length > 0) process.exit(1);
}

// Only when this file *is* the command. Importing it, as the tests do, must
// not start a server.
//
// `realpathSync` matters: npm and npx run this file through a symlink in
// `node_modules/.bin`, and Node resolves `import.meta.url` to the symlink's
// real target. Comparing against the raw `argv[1]` never matched there, so
// `npx @micacms/editor` silently did nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`\n${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
