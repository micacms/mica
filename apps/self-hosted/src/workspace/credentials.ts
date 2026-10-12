/**
 * The repository URL and the credentials that reach it.
 *
 * The token is a password for Git over HTTPS. It never goes into the URL or a
 * file: Git asks a credential helper for it, and the helper reads it from the
 * environment of that one `git` process (`isolation.ts`). The helper is scoped
 * to the configured host, so a redirect or a second remote gets nothing.
 */

import { ConfigError, LOOPBACK } from "@micacms/runtime";

export interface Remote {
  /** The URL as configured, without credentials. */
  url: string;
  scheme: "https" | "http";
  /** `host` or `host:port` — the key a credential helper is scoped to. Git drops a default port. */
  hostKey: string;
}

/**
 * Checks `MICA_REPOSITORY_URL`. Plain HTTP is accepted only in development,
 * on a loopback host — the same rule as for the OIDC issuer, and what the
 * tests need.
 */
export function parseRemote(raw: string, development: boolean): Remote {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(
      `MICA_REPOSITORY_URL is not a URL: "${raw}".\n` +
        "  Use the HTTPS clone URL, for example https://gitlab.com/group/project.git",
    );
  }

  if (url.username || url.password) {
    throw new ConfigError(
      "MICA_REPOSITORY_URL contains credentials. Remove them from the URL and set\n" +
        "  MICA_REPOSITORY_TOKEN instead; Mica never writes a token into the clone.",
    );
  }

  const loopback = LOOPBACK.has(url.hostname.replace(/^\[|\]$/g, ""));
  if (url.protocol !== "https:" && !(url.protocol === "http:" && development && loopback)) {
    throw new ConfigError(
      `MICA_REPOSITORY_URL must be an https:// URL, not "${url.protocol}".\n` +
        "  SSH remotes are not supported yet. Plain http:// works only with\n" +
        "  NODE_ENV=development and a loopback host.",
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
 * The username Git sends with the token. GitHub, GitLab and Forgejo accept any
 * non-empty name with a token (spike S1); these are the names their docs use.
 */
export function defaultUsername(remote: Remote): string {
  const host = remote.hostKey.split(":")[0];
  if (host === "github.com") return "x-access-token";
  if (host === "gitlab.com") return "oauth2";
  return "mica";
}

/**
 * Removes credentials from text that may reach a log or an editor: any
 * `user:password@` in a URL, and every value in `secrets`.
 */
export function redact(text: string, secrets: Array<string | undefined>): string {
  let clean = text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@]*@/gi, "$1");
  for (const secret of secrets) {
    if (secret && secret.length >= 4) clean = clean.split(secret).join("***");
  }
  return clean;
}
