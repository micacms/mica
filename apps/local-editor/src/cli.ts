#!/usr/bin/env node
/**
 * `npx mica start` — Mica against a project on this machine.
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
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";

import { MANIFEST_PATH } from "@micacms/core/internal";
import { DEFAULT_PORT, SchemaError, VERSION } from "@micacms/runtime";

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
  /** `import`: Astro's data store. */
  from?: string;
  /** `import`: `collection.field` → the key in Astro's data. */
  map: Record<string, string>;
  /** `import`: collection → the field that gives the first order. */
  order: Record<string, string>;
  /** `import`: the collections to import; empty for all. */
  collections: string[];
  /** `mcp`: offer the publish tool. */
  allowPublish?: boolean;
}

export type Command = "start" | "check" | "import" | "mcp";

/** Every option of the CLI, for `util.parseArgs`. */
const OPTIONS = {
  content: { type: "string", short: "c" },
  port: { type: "string", short: "p" },
  host: { type: "string" },
  open: { type: "boolean" },
  from: { type: "string" },
  map: { type: "string", multiple: true },
  order: { type: "string", multiple: true },
  collection: { type: "string", multiple: true },
  "allow-publish": { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const satisfies ParseArgsOptionsConfig;

/** The options of each command. A path without an option is always the content root. */
const ALLOWED: Record<Command, ReadonlyArray<keyof typeof OPTIONS>> = {
  start: ["content", "port", "host", "open", "help", "version"],
  check: ["content", "help", "version"],
  import: ["content", "from", "map", "order", "collection", "help", "version"],
  mcp: ["content", "allow-publish", "help", "version"],
};

const USAGE = `
  mica — edit your Astro project's content, on this machine

  Usage
    $ npx mica start [content dir]    open the editor
    $ npx mica init                   add Mica to this Astro project
    $ npx mica check [content dir]    check every entry against the model
    $ npx mica import [content dir]   move Astro collections into Mica
    $ npx mica mcp [content dir]      serve the tools to a coding agent, over stdio

  Before @micacms/editor is installed in the project: npx @micacms/editor <command>.

  Options of start
    -c, --content <dir>      The content root (default: the directory with a .mica/schema.json)
    -p, --port <number>      Port to listen on (default: ${DEFAULT_PORT})
        --host <address>     Address to bind (default: 127.0.0.1)
        --no-open            Do not open the browser

  Options of check
    -c, --content <dir>      The content root

  Options of mcp
    -c, --content <dir>      The content root
        --allow-publish      Offer the publish tool too. Without it, the agent saves drafts

  Options of import
    -c, --content <dir>      The content root
        --collection <name>  Import only this collection; use it more than once
        --from <file>        Astro's data store (default: node_modules/.astro/data-store.json)
        --map <c.field=key>  Take a field from another key; @body is the Markdown body
        --order <c=field>    The initial order of a sortable collection

    -h, --help               Show this
    -v, --version            Print the version

  There is no sign-in here, because there is nothing to sign in to: this mode
  has no identity provider, no account and no user. That is right for your own
  machine and wrong everywhere else — a Mica other people reach runs as a
  container with an identity provider. See https://micacms.com/docs/self-hosting/.
`;

export function parse(argv: string[], command: Command = "start"): Options {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, allowNegative: true, strict: true, tokens: true });
  } catch (error) {
    // Node names the option: "Unknown option '--x'", "Option '-c, --content <value>' argument missing".
    fail(`${(error as Error).message.split(/\.\s|\n/)[0]!.replace(/\.$/, "")}.`);
  }
  for (const token of parsed.tokens) {
    if (token.kind === "option" && !ALLOWED[command].includes(token.name as keyof typeof OPTIONS)) {
      fail(`${command} has no option ${token.rawName}.`);
    }
  }

  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  }
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    process.exit(0);
  }

  // A bare path is the content root, so `npx mica start ./site/content` does what it looks like it does.
  const directories = [...(values.content === undefined ? [] : [values.content]), ...positionals];
  if (directories.length > 1) fail(`${command} takes one content directory, not ${directories.map((dir) => `"${dir}"`).join(" and ")}.`);

  /** `--map a=b --map c=d` as `{ a: "b", c: "d" }`. */
  const pairs = (flag: string, texts: string[] = []): Record<string, string> =>
    Object.fromEntries(
      texts.map((text) => {
        const at = text.indexOf("=");
        if (at < 1 || at === text.length - 1) fail(`${flag} takes name=value, for example team.image.alt=alt.`);
        return [text.slice(0, at), text.slice(at + 1)];
      }),
    );

  return {
    ...(directories[0] !== undefined ? { content: directories[0] } : {}),
    ...(values.port !== undefined ? { port: values.port } : {}),
    ...(values.host !== undefined ? { host: values.host } : {}),
    ...(values.open !== undefined ? { open: values.open } : {}),
    ...(values.from !== undefined ? { from: values.from } : {}),
    map: pairs("--map", values.map),
    order: pairs("--order", values.order),
    collections: values.collection ?? [],
    ...(values["allow-publish"] !== undefined ? { allowPublish: values["allow-publish"] } : {}),
  };
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
  report(message, ["Run `npx mica --help` to see every command and option."]);
  process.exit(64); // EX_USAGE
}

/**
 * Opening a browser is a courtesy, so it is offered only where it can be
 * welcome: an interactive terminal that somebody is sitting at. A script, a
 * container and a CI job all get a server and no surprises.
 */
export function shouldOpenBrowser(options: Pick<Options, "open">, env: NodeJS.ProcessEnv): boolean {
  if (options.open !== undefined) return options.open;
  return Boolean(process.stdout.isTTY) && !env["CI"];
}

/** A variable's value, with a blank one counted as not set. */
const set = (value: string | undefined): string | undefined => (value?.trim() ? value : undefined);

/**
 * The content root: the flag or path, else `MICA_CONTENT_ROOT`, else the one
 * directory with a `.mica/schema.json` under `cwd`, else `./content`.
 */
export function contentRoot(options: Pick<Options, "content">, env: NodeJS.ProcessEnv, cwd = process.cwd()): string {
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
export function serverEnvironment(options: Pick<Options, "port" | "host" | "open">, env: NodeJS.ProcessEnv, content: string): Record<string, string> {
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
  if (command === "mcp") return mcp(rest);
  // The first word is always a command, so that a directory named `init` is not one.
  if (command === undefined || command === "-h" || command === "--help") return void process.stdout.write(`${USAGE}\n`);
  if (command === "-v" || command === "--version") return void process.stdout.write(`${VERSION}\n`);
  if (command !== "start") fail(`Unknown command "${command}". To open the editor: npx mica start`);

  const options = parse(rest, "start");
  const content = contentRoot(options, process.env);
  requireContent(content);

  Object.assign(process.env, serverEnvironment(options, process.env, content));

  // The server is imported rather than spawned: one process, one signal
  // handler, and a stack trace that points at the real thing.
  await import("./index.js");
}

/** Stops with a message the person can act on when there is no content directory or no model. */
function requireContent(content: string): void {
  if (!existsSync(content)) {
    report(`There is no content directory at ${content}.`, [
      "Mica edits the directory your Astro project publishes content into —",
      "the `root` in your `defineSite({ root: \"./content\" })`.",
      "",
      "  npx mica start ./path/to/content",
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
      "If you have not defined a model yet, run `npx mica init`, or see",
      "https://micacms.com/docs/getting-started/.",
    ]);
    process.exit(78); // EX_CONFIG
  }
}

/** The tools over stdio. The agent starts this command; everything it prints goes to stderr. */
async function mcp(argv: string[]): Promise<void> {
  const options = parse(argv, "mcp");
  const content = contentRoot(options, process.env);
  requireContent(content);

  Object.assign(process.env, {
    MICA_CONTENT_ROOT: content,
    ...(options.allowPublish ? { MICA_MCP_PUBLISH: "true" } : {}),
  });
  await import("./mcp.js");
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
  const root = contentRoot(parse(argv, "check"), process.env);
  const result = await checkContent(root);
  process.stdout.write(formatReport(result, root));
  // Without a model nothing was checked: a configuration problem, not a content one.
  if (!result.model) process.exit(78); // EX_CONFIG
  if (result.problems.some((problem) => problem.level === "error")) process.exit(1);
}

async function importCommand(argv: string[]): Promise<void> {
  const options = parse(argv, "import");
  // `astro sync` and `astro build` write the store into node_modules; `astro dev` into .astro.
  const stores = ["node_modules/.astro/data-store.json", ".astro/data-store.json"];
  const store = options.from ?? stores.find((file) => existsSync(file)) ?? stores[0]!;
  try {
    const result = await importCollections({
      root: contentRoot(options, process.env),
      project: process.cwd(),
      store: path.resolve(store),
      map: options.map,
      order: options.order,
      only: options.collections,
    });
    process.stdout.write(formatImport(result));
  } catch (error) {
    if (!(error instanceof ImportError)) throw error;
    // Without a model nothing can be imported: a configuration problem.
    const noModel = error.cause instanceof SchemaError;
    report(error.message, noModel ? ["Write the content model first: npx astro sync"] : []);
    process.exit(noModel ? 78 : 1); // EX_CONFIG
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
