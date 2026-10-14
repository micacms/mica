/**
 * The self-hosted configuration: the runtime and auth fragments, plus the
 * repository and the data directory. The environment is parsed once; the
 * repository settings are built from the parsed values.
 *
 * Plain HTTP is allowed only for addresses on this machine, as in a trial or a
 * test. There is no development mode: `NODE_ENV` changes nothing.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import { authEnv, deriveAuth, requireAuthConfig, type AuthConfig } from "@micacms/auth-oidc";
import {
  ConfigError,
  deriveRuntime,
  describeConfigIssues,
  isLoopbackUrl,
  loadEnvFile,
  runtimeEnv,
  withoutBlanks,
  type RuntimeConfig,
} from "@micacms/runtime";

import { defaultUsername, parseRemote, type Remote } from "./workspace/credentials.js";

/** What the runtime reads, minus what only the local editor's checkout needs. */
const {
  MICA_CONTENT_ROOT: _contentRoot,
  MICA_LOCAL_PUBLISH: _localPublish,
  ...runtimeFields
} = runtimeEnv;

/** Secrets that can come from a file, such as a Docker or Kubernetes secret: `<NAME>_FILE`. */
const FILE_SECRETS = ["MICA_SESSION_SECRET", "MICA_OIDC_CLIENT_SECRET"] as const;

const fields = {
  ...runtimeFields,
  ...authEnv,
  MICA_SESSION_SECRET_FILE: z.string().optional(),
  MICA_OIDC_CLIENT_SECRET_FILE: z.string().optional(),

  MICA_DATA_DIR: z.string().default("./data"),
  /** The HTTPS clone URL, without credentials. */
  MICA_REPOSITORY_URL: z.string().optional(),
  MICA_REPOSITORY_TOKEN: z.string().optional(),
  /** A file with the token, read for each Git call: a short-lived token can change without a restart. */
  MICA_REPOSITORY_TOKEN_FILE: z.string().optional(),
  /** Defaults by host: `x-access-token` (GitHub), `oauth2` (GitLab), `mica`. */
  MICA_REPOSITORY_USERNAME: z.string().optional(),
  MICA_REPOSITORY_BRANCH: z.string().default("main"),
  MICA_REPOSITORY_ROOT: z.string().default("content"),
  MICA_REPOSITORY_SYNC_SECONDS: z.coerce.number().int().min(5).max(86_400).default(60),
};

/** Every variable the image reads. Built from the schema's fields, so the two cannot drift. */
export const KNOWN = new Set(Object.keys(fields));

const schema = z.object(fields);

export interface RepositoryConfig {
  remote: Remote;
  branch: string;
  /** Content root, repository-relative, without leading or trailing slashes. */
  root: string;
  /** `MICA_REPOSITORY_TOKEN`, or null when `tokenFile` holds the token. */
  token: string | null;
  tokenFile: string | null;
  username: string;
  syncSeconds: number;
}

/** The token as it is now: a token file is read again for each call. */
export function currentToken(repository: RepositoryConfig): string {
  return repository.token ?? readFileSync(repository.tokenFile!, "utf8").trim();
}

export type SelfHostedConfig = RuntimeConfig &
  AuthConfig & {
    dataDir: string;
    repository: RepositoryConfig;
    /** `MICA_*` names in the environment that nothing reads: likely typos. */
    unknownVariables: string[];
  };

/**
 * Git's rules for a branch name, enough to refuse anything that could act as an
 * option or a range.
 */
function isBranchName(name: string): boolean {
  return (
    name.length > 0 &&
    !name.startsWith("-") &&
    !name.startsWith("/") &&
    !name.endsWith("/") &&
    !name.endsWith(".lock") &&
    !name.includes("..") &&
    !name.includes("@{") &&
    !/[\s~^:?*[\\\x00-\x1f\x7f]/.test(name)
  );
}

/** Puts the contents of `<NAME>_FILE` into `<NAME>`, for each secret that can come from a file. */
function readSecretFiles(env: NodeJS.ProcessEnv, problems: string[]): NodeJS.ProcessEnv {
  const result = { ...env };
  for (const name of FILE_SECRETS) {
    const file = env[`${name}_FILE`];
    if (!file) continue;
    if (env[name]) {
      problems.push(`${name} and ${name}_FILE are both set. Set one of them.`);
      continue;
    }
    try {
      result[name] = readFileSync(file, "utf8").trim();
    } catch (error) {
      problems.push(`${name}_FILE names ${file}, which cannot be read: ${(error as Error).message}`);
    }
  }
  return result;
}

/** All repository problems at once, so an operator fixes them in one pass. */
function repositoryOf(env: z.infer<typeof schema>, problems: string[]): RepositoryConfig | null {
  let remote: Remote | undefined;
  if (!env.MICA_REPOSITORY_URL) {
    problems.push("MICA_REPOSITORY_URL is not set. It is the HTTPS clone URL of the content repository.");
  } else {
    try {
      remote = parseRemote(env.MICA_REPOSITORY_URL);
    } catch (error) {
      problems.push((error as Error).message);
    }
  }

  const token = env.MICA_REPOSITORY_TOKEN ?? null;
  const tokenFile = env.MICA_REPOSITORY_TOKEN_FILE ?? null;
  if (token && tokenFile) {
    problems.push("MICA_REPOSITORY_TOKEN and MICA_REPOSITORY_TOKEN_FILE are both set. Set one of them.");
  } else if (!token && !tokenFile) {
    problems.push(
      "MICA_REPOSITORY_TOKEN is not set. GitHub: a fine-grained token with Contents: read and write.\n" +
        "    GitLab: a project access token with read_repository and write_repository, and a role that may\n" +
        "    push to the branch. MICA_REPOSITORY_TOKEN_FILE can name a file with the token instead.",
    );
  } else if (tokenFile) {
    try {
      readFileSync(tokenFile, "utf8");
    } catch (error) {
      problems.push(`MICA_REPOSITORY_TOKEN_FILE names ${tokenFile}, which cannot be read: ${(error as Error).message}`);
    }
  }

  const branch = env.MICA_REPOSITORY_BRANCH;
  if (!isBranchName(branch)) problems.push(`MICA_REPOSITORY_BRANCH is not a branch name: "${branch}".`);

  const root = env.MICA_REPOSITORY_ROOT.replace(/^\/+|\/+$/g, "");
  if (root.split("/").some((segment) => segment === ".." || segment === ".")) {
    problems.push(`MICA_REPOSITORY_ROOT must be a path inside the repository: "${root}".`);
  }

  if (!remote) return null;
  return {
    remote,
    branch,
    root,
    token,
    tokenFile,
    username: env.MICA_REPOSITORY_USERNAME ?? defaultUsername(remote),
    syncSeconds: env.MICA_REPOSITORY_SYNC_SECONDS,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SelfHostedConfig {
  // Tests pass an explicit object and must not pick up a `.env` in the working directory.
  if (env === process.env) loadEnvFile();
  const problems: string[] = [];
  const present = readSecretFiles(withoutBlanks(env), problems);

  // The default is a localhost address: a deployment that forgets the variable would sign in nowhere.
  if (!present["MICA_PUBLIC_URL"]) {
    problems.push(
      "MICA_PUBLIC_URL is not set. It is the https:// address the browser shows, or http://localhost:6422 for a trial on this machine.",
    );
  }

  const parsed = schema.safeParse(present);
  if (!parsed.success) throw new ConfigError(describeConfigIssues(parsed.error));
  const repository = repositoryOf(parsed.data, problems);

  if (problems.length > 0 || !repository) {
    throw new ConfigError(
      `Mica cannot start:\n${problems.map((problem) => `  - ${problem}`).join("\n")}\n` +
        "  See deploy/self-hosted/.env.example.",
    );
  }

  const dataDir = path.resolve(parsed.data.MICA_DATA_DIR);
  const runtime = deriveRuntime({
    ...parsed.data,
    MICA_CONTENT_ROOT: path.join(dataDir, "repository", repository.root),
    MICA_LOCAL_PUBLISH: true,
  });
  const config = {
    ...deriveAuth(runtime),
    // A container has to bind every interface to be reachable at all.
    HOST: parsed.data.HOST ?? "0.0.0.0",
    dataDir,
    sessionSecret: parsed.data.MICA_SESSION_SECRET,
  };

  requireAuthConfig(config);
  // Over plain HTTP the session cookie is not Secure and travels in clear text.
  if (!config.MICA_PUBLIC_URL.startsWith("https://") && !isLoopbackUrl(config.MICA_PUBLIC_URL)) {
    throw new ConfigError(
      `MICA_PUBLIC_URL is ${config.MICA_PUBLIC_URL}, but an address on another machine needs https://.\n` +
        "  Put Mica behind a reverse proxy that terminates TLS, and set MICA_PUBLIC_URL to its https:// address.",
    );
  }

  return {
    ...config,
    repository,
    unknownVariables: Object.keys(env)
      .filter((name) => name.startsWith("MICA_") && !KNOWN.has(name))
      .sort(),
  };
}
