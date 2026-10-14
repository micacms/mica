#!/usr/bin/env node
/**
 * `npx @micacms/editor start` — Mica against a project on this machine.
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

import { existsSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { MANIFEST_PATH } from "@micacms/core/internal";
import { DEFAULT_PORT, VERSION } from "@micacms/runtime";

import { checkContent, formatReport } from "./check.js";
import { formatInit, initProject, InitError } from "./init.js";
import { formatImport, importCollections, ImportError } from "./import.js";

export interface Options {
  /** Undefined means "not given": see `contentRoot`. */
  content?: string;
  port?: string;
  host?: string;
  /** Undefined means "decide from the terminal" — see `shouldOpenBrowser`. */
  open?: boolean;
}

const USAGE = `
  mica — edit your Astro project's content, on this machine

  Usage
    $ npx @micacms/editor start [content dir]   open the editor
    $ npx @micacms/editor init                  add Mica to this Astro project
    $ npx @micacms/editor check [content dir]   check every entry against the model
    $ npx @micacms/editor import [names]        move Astro collections into Mica
        --from <file>         Astro's data store (default: node_modules/.astro/data-store.json)
        --map <c.field=key>   take a field from another key; @body is the Markdown body
        --order <c=field>     the initial order of a sortable collection

  With @micacms/editor installed in the project, \`npx mica\` is the same command.

  Options of start
    -c, --content <dir>   The content root (default: the directory with a .mica/schema.json)
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
        // A bare path is the content root, so `npx @micacms/editor start ./site/content`
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
  report(message, ["Run `npx @micacms/editor --help` to see every command and option."]);
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

/**
 * The content root: the flag or path, else `MICA_CONTENT_ROOT`, else the one
 * directory with a `.mica/schema.json` under `cwd`, else `./content`.
 */
export function contentRoot(options: Options, env: NodeJS.ProcessEnv, cwd = process.cwd()): string {
  const given = options.content ?? set(env["MICA_CONTENT_ROOT"]);
  if (given) return path.resolve(cwd, given);
  const found = contentRootsUnder(cwd);
  if (found.length > 1) {
    const listed = found.map((root) => `  ${path.relative(cwd, root) || "."}`);
    report("There is more than one content root here.", [...listed, "", "Name the one to use, for example: npx mica check ./content"]);
    process.exit(64); // EX_USAGE
  }
  return found[0] ?? path.join(cwd, "content");
}

/** The directories with a `.mica/schema.json`, at most `depth` levels down. Skips `node_modules` and hidden directories. */
export function contentRootsUnder(dir: string, depth = 3): string[] {
  if (existsSync(path.join(dir, MANIFEST_PATH))) return [dir];
  if (depth === 0) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith("."))
    .flatMap((entry) => contentRootsUnder(path.join(dir, entry.name), depth - 1));
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
  if (command === "import") return importCommand(rest);
  // The first word is always a command, so that a directory named `init` is not one.
  if (command === undefined || command === "-h" || command === "--help") return void process.stdout.write(`${USAGE}\n`);
  if (command === "-v" || command === "--version") return void process.stdout.write(`${VERSION}\n`);
  if (command !== "start") fail(`Unknown command "${command}". To open the editor: npx @micacms/editor start`);

  const options = parse(rest);
  const content = contentRoot(options, process.env);

  if (!existsSync(content)) {
    report(`There is no content directory at ${content}.`, [
      "Mica edits the directory your Astro project publishes content into —",
      "the `root` in your `defineSite({ root: \"./content\" })`.",
      "",
      "  npx @micacms/editor start ./path/to/content",
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

async function importCommand(argv: string[]): Promise<void> {
  // `astro sync` and `astro build` write the store into node_modules; `astro dev` into .astro.
  const found = ["node_modules/.astro/data-store.json", ".astro/data-store.json"].find((file) => existsSync(file));
  const options = { store: found ?? "node_modules/.astro/data-store.json", map: {} as Record<string, string>, order: {} as Record<string, string>, only: [] as string[], content: undefined as string | undefined };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]!;
    const value = (): string => {
      const next = argv[++index];
      if (next === undefined || next.startsWith("-")) fail(`${flag} needs a value.`);
      return next!;
    };
    const pair = (text: string): [string, string] => {
      const at = text.indexOf("=");
      if (at < 1 || at === text.length - 1) fail(`${flag} takes name=value, for example team.image.alt=alt.`);
      return [text.slice(0, at), text.slice(at + 1)];
    };
    if (flag === "--from") options.store = value();
    else if (flag === "--content" || flag === "-c") options.content = value();
    else if (flag === "--map") { const [to, from] = pair(value()); options.map[to] = from; }
    else if (flag === "--order") { const [name, field] = pair(value()); options.order[name] = field; }
    else if (flag.startsWith("-")) fail(`Unknown option "${flag}".`);
    else options.only.push(flag);
  }
  try {
    const result = await importCollections({
      root: contentRoot({ content: options.content }, process.env),
      project: process.cwd(),
      store: path.resolve(options.store),
      map: options.map,
      order: options.order,
      only: options.only,
    });
    process.stdout.write(formatImport(result));
  } catch (error) {
    if (!(error instanceof ImportError)) throw error;
    report(error.message, []);
    process.exit(1);
  }
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
