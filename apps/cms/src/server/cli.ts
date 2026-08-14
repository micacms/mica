#!/usr/bin/env node
/**
 * `npx @micacms/cms` — Mica against a project on this machine.
 *
 * The point of this file is that adopting Mica should not mean adopting this
 * repository. Everything it does is set environment variables and hand over to
 * the same entry point a container runs, so there is one server with one
 * configuration path and this is a front door rather than a second one.
 *
 * Two defaults differ from the container's, and both are deliberate:
 *
 *   - it binds to loopback. The server binds 0.0.0.0 because a container has
 *     to; a laptop does not, and this mode disables authentication. Anything
 *     reachable by anyone else needs `docker compose`, an identity provider and
 *     `MICA_MODE=self-hosted` — see docs/self-hosting.md.
 *   - accounts and sessions go to a cache directory outside the project. In
 *     local mode there is one implicit developer and nothing worth keeping, so
 *     writing a database into somebody's repository would be litter.
 *
 * Explicit environment wins over every flag default here, and a flag wins over
 * a `.env` file, because `loadConfig` leaves already-set variables alone.
 */

import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { MANIFEST_PATH } from "@micacms/model";

import { VERSION } from "./lib/version.js";

export interface Options {
  content: string;
  port?: string;
  host?: string;
  data?: string;
}

const USAGE = `
  mica — edit a project's content locally

  Usage
    $ npx @micacms/cms [options]

  Options
    -c, --content <dir>   The content root (default: ./content)
    -p, --port <number>   Port to listen on (default: 4000)
        --host <address>  Address to bind (default: 127.0.0.1)
        --data <dir>      Where accounts and sessions are kept
    -h, --help            Show this
    -v, --version         Print the version

  Authentication is DISABLED here: every request is one developer account.
  That is right for your own machine and wrong everywhere else — to deploy
  Mica, run the container with an identity provider instead.
`;

export function parse(argv: string[]): Options {
  const options: Options = { content: "./content" };

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
      case "--data":
        options.data = value();
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
        // A bare path is the content root, so `npx @micacms/cms ./site/content`
        // does what it looks like it does.
        if (!flag.startsWith("-")) options.content = flag;
        else fail(`Unknown option "${flag}".`);
    }
  }

  return options;
}

function fail(message: string): never {
  process.stderr.write(`\n${message}\n${USAGE}\n`);
  process.exit(64); // EX_USAGE
}

/**
 * A per-project directory outside the project.
 *
 * Keyed by the content root so two checkouts do not share a database, and
 * hashed so the path stays short and has no separators in it. Losing this
 * costs nothing here: local mode has no accounts and no passwords.
 */
export function cacheDir(contentRoot: string): string {
  const base =
    process.env["XDG_CACHE_HOME"] ??
    (process.platform === "darwin"
      ? path.join(homedir(), "Library", "Caches")
      : process.platform === "win32"
        ? (process.env["LOCALAPPDATA"] ?? path.join(homedir(), "AppData", "Local"))
        : path.join(homedir(), ".cache"));

  const key = createHash("sha256").update(contentRoot).digest("hex").slice(0, 12);
  // `homedir()` can throw on a system with no home directory at all; a
  // temporary directory is still better than writing into the repository.
  return path.join(base || tmpdir(), "mica", key);
}

export async function main(): Promise<void> {
  const options = parse(process.argv.slice(2));
  const content = path.resolve(options.content);

  if (!existsSync(content)) {
    fail(
      `No content directory at ${content}.\n` +
        `  Point --content at the directory your Astro project publishes,\n` +
        `  or create it and let Mica write the first entry.`,
    );
  }

  // A far more useful message than the server's, because here we know the
  // project is on this machine and can name the command that fixes it.
  if (!existsSync(path.join(content, MANIFEST_PATH))) {
    process.stderr.write(
      `\nNo content model at ${path.join(content, MANIFEST_PATH)}.\n` +
        `  Mica ships without one: your Astro project defines it and writes it there.\n` +
        `  Run \`npx astro build\` (or start the dev server once) in that project first.\n\n`,
    );
    process.exit(78); // EX_CONFIG
  }

  const defaults: Record<string, string> = {
    CONTENT_ROOT: content,
    REPOSITORY: "local",
    MICA_MODE: "local",
    HOST: options.host ?? "127.0.0.1",
    PORT: options.port ?? "4000",
    DATA_DIR: options.data ? path.resolve(options.data) : cacheDir(content),
  };

  for (const [key, value] of Object.entries(defaults)) {
    process.env[key] ??= value;
  }
  // CMS_BASE_URL has to agree with the port, and only matters here for cookie
  // scope and the Origin check — both of which are this process's own address.
  process.env["CMS_BASE_URL"] ??= `http://localhost:${process.env["PORT"]}`;

  // The server is imported rather than spawned: one process, one signal
  // handler, and a stack trace that points at the real thing.
  await import("./index.js");
}

// Only when this file *is* the command. Importing it — which the tests do, and
// which a future `mica init` would — must not start a server.
//
// `realpathSync` matters: npm and npx run this file through a symlink in
// `node_modules/.bin`, and Node resolves `import.meta.url` to the symlink's
// real target. Comparing against the raw `argv[1]` never matched there, so
// `npx @micacms/cms` silently did nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`\n${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}
