/**
 * The self-hosted configuration: the runtime and auth fragments, plus the
 * repository and the data directory.
 */

import { randomBytes } from "node:crypto";
import path from "node:path";
import { z } from "zod";

import { authEnv, deriveAuth, requireAuthConfig, type AuthConfig } from "@micacms/auth-oidc";
import {
  ConfigError,
  deriveRuntime,
  describeConfigIssues,
  loadEnvFile,
  LOOPBACK,
  runtimeEnv,
  withoutBlanks,
  type RuntimeConfig,
} from "@micacms/runtime";

import { defaultUsername, parseRemote, type Remote } from "./workspace/credentials.js";

/** What the runtime reads, minus what only the local editor's checkout needs. */
const {
  CONTENT_ROOT: _contentRoot,
  MICA_LOCAL_PUBLISH: _localPublish,
  ...runtimeFields
} = runtimeEnv;

const fields = {
  ...runtimeFields,
  ...authEnv,

  MICA_DATA_DIR: z.string().default("./data"),
  /** The HTTPS clone URL, without credentials. */
  MICA_REPOSITORY_URL: z.string().optional(),
  MICA_REPOSITORY_TOKEN: z.string().optional(),
  /** Defaults by host: `x-access-token` (GitHub), `oauth2` (GitLab), `mica`. */
  MICA_REPOSITORY_USERNAME: z.string().optional(),
  MICA_REPOSITORY_BRANCH: z.string().default("main"),
  MICA_REPOSITORY_ROOT: z.string().default("content"),
  MICA_REPOSITORY_SYNC_SECONDS: z.coerce.number().int().min(5).max(86_400).default(60),
};

/** Built from the schema's fields, so the two cannot drift. */
const KNOWN = new Set(Object.keys(fields));

const schema = z.object(fields).transform((env) => {
  const dataDir = path.resolve(env.MICA_DATA_DIR);
  const root = env.MICA_REPOSITORY_ROOT.replace(/^\/+|\/+$/g, "");
  const runtime = deriveRuntime({
    ...env,
    CONTENT_ROOT: path.join(dataDir, "repository", root),
    MICA_LOCAL_PUBLISH: true,
  });
  return {
    ...deriveAuth(runtime),
    // A container has to bind every interface to be reachable at all.
    HOST: env.HOST ?? "0.0.0.0",
    dataDir,
  };
});

export interface RepositoryConfig {
  remote: Remote;
  branch: string;
  /** Content root, repository-relative, without leading or trailing slashes. */
  root: string;
  token: string;
  username: string;
  syncSeconds: number;
}

export type SelfHostedConfig = RuntimeConfig &
  AuthConfig & {
    dataDir: string;
    repository: RepositoryConfig;
    SESSION_SECRET?: string | undefined;
    /** Names of the secrets this process generated for itself. */
    devSecrets: string[];
    /** `MICA_*` names in the environment that nothing reads: likely typos. */
    unknownVariables: string[];
  };

/**
 * Over plain HTTP the session cookie is not Secure and travels in clear text,
 * so production refuses it. Loopback stays allowed, for a trial on one machine.
 */
function requireHttps(
  config: { isProduction: boolean; MICA_PUBLIC_URL: string },
  env: NodeJS.ProcessEnv,
): void {
  // The default is a localhost address, which would pass the loopback rule below.
  if (config.isProduction && !env["MICA_PUBLIC_URL"]) {
    throw new ConfigError(
      "MICA_PUBLIC_URL is not set. In production it must be the https:// address the browser shows.",
    );
  }
  const url = new URL(config.MICA_PUBLIC_URL);
  if (!config.isProduction || url.protocol === "https:" || LOOPBACK.has(url.hostname)) return;

  throw new ConfigError(
    `MICA_PUBLIC_URL is ${config.MICA_PUBLIC_URL}, but production needs an https:// address.\n` +
      "  Put Mica behind a reverse proxy that terminates TLS, and set MICA_PUBLIC_URL to its https:// address.",
  );
}

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

/** All repository problems at once, so an operator fixes them in one pass. */
function repositoryProblems(env: NodeJS.ProcessEnv, development: boolean): { problems: string[]; repository?: RepositoryConfig } {
  const problems: string[] = [];

  const url = env["MICA_REPOSITORY_URL"];
  let remote: Remote | undefined;
  if (!url) {
    problems.push("MICA_REPOSITORY_URL is not set. It is the HTTPS clone URL of the content repository.");
  } else {
    try {
      remote = parseRemote(url, development);
    } catch (error) {
      problems.push((error as Error).message);
    }
  }

  const token = env["MICA_REPOSITORY_TOKEN"];
  if (!token) {
    problems.push(
      "MICA_REPOSITORY_TOKEN is not set. GitHub: a fine-grained token with Contents: read and write.\n" +
        "    GitLab: a project access token with read_repository and write_repository, and a role that may\n" +
        "    push to the branch.",
    );
  }

  const branch = env["MICA_REPOSITORY_BRANCH"] ?? "main";
  if (!isBranchName(branch)) problems.push(`MICA_REPOSITORY_BRANCH is not a branch name: "${branch}".`);

  const root = (env["MICA_REPOSITORY_ROOT"] ?? "content").replace(/^\/+|\/+$/g, "");
  if (root.split("/").some((segment) => segment === ".." || segment === ".")) {
    problems.push(`MICA_REPOSITORY_ROOT must be a path inside the repository: "${root}".`);
  }

  if (problems.length > 0 || !remote || !token) return { problems };
  return {
    problems,
    repository: {
      remote,
      branch,
      root,
      token,
      username: env["MICA_REPOSITORY_USERNAME"] ?? defaultUsername(remote),
      syncSeconds: Number(env["MICA_REPOSITORY_SYNC_SECONDS"] ?? 60),
    },
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SelfHostedConfig {
  // Tests pass an explicit object and must not pick up a `.env` in the working directory.
  if (env === process.env) loadEnvFile();
  const present = withoutBlanks(env);

  const { problems, repository } = repositoryProblems(present, (present["NODE_ENV"] ?? "development") === "development");
  if (problems.length > 0) {
    throw new ConfigError(
      `Mica cannot start:\n${problems.map((problem) => `  - ${problem}`).join("\n")}\n` +
        "  See deploy/self-hosted/.env.example.",
    );
  }

  const parsed = schema.safeParse(present);
  if (!parsed.success) throw new ConfigError(describeConfigIssues(parsed.error));

  const config = parsed.data;

  requireAuthConfig(config);
  requireHttps(config, present);

  // In development a generated secret lets a trial run work from a clean
  // checkout; sessions end on restart.
  const missing: string[] = [];
  if (!config.SESSION_SECRET) missing.push("SESSION_SECRET");

  if (config.isProduction && missing.length > 0) {
    throw new ConfigError(
      `Missing required production secrets: ${missing.join(", ")}.\n` +
        `Generate them with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }

  return {
    ...config,
    repository: repository!,
    sessionSecret: config.SESSION_SECRET ?? randomBytes(32).toString("hex"),
    devSecrets: missing,
    unknownVariables: Object.keys(env)
      .filter((name) => name.startsWith("MICA_") && !KNOWN.has(name))
      .sort(),
  };
}
