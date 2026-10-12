/**
 * A Git host for tests: bare repositories served over HTTP on loopback by
 * `git http-backend`, behind Basic authentication with one token.
 *
 * Real Git on both ends, so the managed workspace's credential path runs in
 * `rush test` exactly as it does against a real host.
 */

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface GitHost {
  /** `http://127.0.0.1:<port>/<name>.git` */
  url(name: string): string;
  /** Path of a bare repository on disk. */
  bare(name: string): string;
  /** Every `Authorization` header the host saw. */
  authorizations: string[];
  /** Answer 403 to every push, as a read-only token gets. */
  readOnly: boolean;
  close(): Promise<void>;
}

export async function startGitHost(token: string): Promise<GitHost> {
  const root = mkdtempSync(join(tmpdir(), "mica-git-host-"));
  const authorizations: string[] = [];
  const host = { readOnly: false };

  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization ?? "";
    authorizations.push(auth);
    const [, password] = auth.startsWith("Basic ")
      ? Buffer.from(auth.slice(6), "base64").toString().split(/:(.*)/s)
      : [];
    if (password !== token) {
      res.writeHead(401, { "WWW-Authenticate": 'Basic realm="test"' });
      res.end("Authentication required\n");
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    if (host.readOnly && (url.pathname.endsWith("/git-receive-pack") || url.searchParams.get("service") === "git-receive-pack")) {
      res.writeHead(403);
      res.end("remote: You are not allowed to upload code.\n");
      return;
    }

    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: "1",
      REQUEST_METHOD: req.method,
      PATH_INFO: decodeURIComponent(url.pathname),
      QUERY_STRING: url.search.slice(1),
      CONTENT_TYPE: req.headers["content-type"] ?? "",
      REMOTE_USER: "editor",
      REMOTE_ADDR: "127.0.0.1",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    };
    if (req.headers["git-protocol"]) env.GIT_PROTOCOL = String(req.headers["git-protocol"]);
    if (req.headers["content-encoding"]) env.HTTP_CONTENT_ENCODING = String(req.headers["content-encoding"]);
    if (req.headers["content-length"]) env.CONTENT_LENGTH = String(req.headers["content-length"]);

    const cgi = spawn("git", ["http-backend"], { env });
    req.pipe(cgi.stdin);

    let buffered = Buffer.alloc(0);
    let headersSent = false;
    cgi.stdout.on("data", (chunk: Buffer) => {
      if (headersSent) {
        res.write(chunk);
        return;
      }
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf("\r\n\r\n");
      if (end < 0) return;
      let status = 200;
      const headers: Record<string, string> = {};
      for (const line of buffered.subarray(0, end).toString().split("\r\n")) {
        const colon = line.indexOf(":");
        const key = line.slice(0, colon).trim();
        const value = line.slice(colon + 1).trim();
        if (key.toLowerCase() === "status") status = Number.parseInt(value, 10);
        else headers[key] = value;
      }
      res.writeHead(status, headers);
      headersSent = true;
      const rest = buffered.subarray(end + 4);
      if (rest.length > 0) res.write(rest);
    });
    cgi.on("close", () => res.end());
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: (name) => `http://127.0.0.1:${port}/${name}.git`,
    bare: (name) => join(root, `${name}.git`),
    authorizations,
    get readOnly() {
      return host.readOnly;
    },
    set readOnly(value: boolean) {
      host.readOnly = value;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Plain Git for the "developer" side of a test, with a fixed identity. */
export function devGit(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Developer", "-c", "user.email=dev@example.com", ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
  }).trim();
}

/**
 * Creates `<name>.git` on the host from `files` (repository-relative), and
 * returns a developer checkout of it for pushing upstream changes.
 */
export function seedRepository(host: GitHost, name: string, files: Record<string, string>): string {
  const bare = host.bare(name);
  mkdirSync(bare, { recursive: true });
  devGit(bare, "init", "--quiet", "--bare", "-b", "main");
  devGit(bare, "config", "uploadpack.allowFilter", "true");
  devGit(bare, "config", "uploadpack.allowAnySHA1InWant", "true");
  devGit(bare, "config", "http.receivepack", "true");

  const checkout = mkdtempSync(join(tmpdir(), "mica-dev-"));
  devGit(checkout, "init", "--quiet", "-b", "main");
  for (const [path, contents] of Object.entries(files)) writeIn(checkout, path, contents);
  devGit(checkout, "add", "-A");
  devGit(checkout, "commit", "--quiet", "-m", "Seed");
  devGit(checkout, "remote", "add", "origin", bare);
  devGit(checkout, "push", "--quiet", "origin", "main");
  return checkout;
}

/** Writes a file, creating its directories. */
export function writeIn(dir: string, path: string, contents: string): void {
  const target = join(dir, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, contents);
}

/** Makes the bare repository refuse every push with `message`, as a protected branch does. */
export function refusePushes(host: GitHost, name: string, message: string): void {
  const hook = join(host.bare(name), "hooks", "pre-receive");
  writeFileSync(hook, `#!/bin/sh\necho "${message}" >&2\nexit 1\n`);
  chmodSync(hook, 0o755);
}
