/**
 * The token never goes into the URL or the clone: a credential helper reads it
 * from the environment of each `git` process, or from the operator's token
 * file (`isolation.ts`). The helper is
 * scoped to the configured host, so a redirect or a second remote gets nothing.
 */

import { ConfigError, LOOPBACK } from "@micacms/runtime";

export interface Remote {
  url: string;
  scheme: "https" | "http";
  /** `host` or `host:port` — the key a credential helper is scoped to. Git drops a default port. */
  hostKey: string;
}

/**
 * Checks `MICA_REPOSITORY_URL`, or the variable `name`. Plain HTTP is accepted
 * only on a loopback host, for a test.
 */
export function parseRemote(raw: string, name = "MICA_REPOSITORY_URL"): Remote {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(
      `${name} is not a URL: "${raw}".\n` +
        "  Use the HTTPS clone URL, for example https://gitlab.com/group/project.git",
    );
  }

  if (url.username || url.password) {
    throw new ConfigError(
      `${name} contains credentials. Remove them from the URL and set\n` +
        "  MICA_REPOSITORY_TOKEN instead; Mica never writes a token into the clone.",
    );
  }

  const loopback = LOOPBACK.has(url.hostname.replace(/^\[|\]$/g, ""));
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new ConfigError(
      `${name} must be an https:// URL, not "${url.protocol}".\n` +
        "  SSH remotes are not supported yet. Plain http:// works only on this machine.",
    );
  }

  return {
    url: url.toString(),
    scheme: url.protocol === "https:" ? "https" : "http",
    // `URL` already drops the default port and lowercases the host, as Git does.
    hostKey: url.host,
  };
}

/**
 * The Git LFS endpoint, as Git LFS derives it from the clone URL: the URL with
 * `.git`, then `/info/lfs`.
 */
export function lfsEndpoint(remote: Remote): string {
  const url = remote.url.replace(/\/+$/, "");
  return `${url.endsWith(".git") ? url : `${url}.git`}/info/lfs`;
}

/**
 * GitHub, GitLab and Forgejo accept any non-empty username with a token; these
 * are the names their docs use.
 */
export function defaultUsername(remote: Remote): string {
  const host = remote.hostKey.split(":")[0];
  if (host === "github.com") return "x-access-token";
  if (host === "gitlab.com") return "oauth2";
  return "mica";
}

/**
 * Removes any `user:password@` in a URL and every value in `secrets` from text
 * that may reach a log or an editor.
 */
export function redact(text: string, secrets: Array<string | undefined>): string {
  let clean = text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@]*@/gi, "$1");
  for (const secret of secrets) {
    if (secret && secret.length >= 4) clean = clean.split(secret).join("***");
  }
  return clean;
}
