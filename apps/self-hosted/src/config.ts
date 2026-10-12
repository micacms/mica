/**
 * The self-hosted deployment's configuration: the runtime fragment plus the
 * auth fragment plus what only this composition has — the repository it
 * clones, and the data directory the clone lives in.
 *
 * The refusals live where the fragments do — `requireAuthConfig` for OIDC and
 * admission — and this file adds the deployment's own: the repository, the
 * names that 0.5 replaced, a draft database left by 0.4, and secrets that are
 * mandatory in production. Every problem is reported in one message, so an
 * operator fixes an upgrade in one pass.
 */

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
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
  REPOSITORY: _repository,
  MICA_LOCAL_PUBLISH: _localPublish,
  ...runtimeFields
} = runtimeEnv;

const fields = {
  ...runtimeFields,
  ...authEnv,

  /** Holds the clone, and in it the drafts. */
  MICA_DATA_DIR: z.string().default("./data"),
  /** The HTTPS clone URL, without credentials. */
  MICA_REPOSITORY_URL: z.string().optional(),
  /** The password for Git over HTTPS. */
  MICA_REPOSITORY_TOKEN: z.string().optional(),
  /** Defaults by host: `x-access-token` (GitHub), `oauth2` (GitLab), `mica`. */
  MICA_REPOSITORY_USERNAME: z.string().optional(),
  MICA_REPOSITORY_BRANCH: z.string().default("main"),
  /** Where the content root sits inside the repository. */
  MICA_REPOSITORY_ROOT: z.string().default("content"),
  MICA_REPOSITORY_SYNC_SECONDS: z.coerce.number().int().min(5).max(86_400).default(60),
};

/** Every variable this server reads, from the same object as the schema, so they cannot drift. */
const KNOWN = new Set(Object.keys(fields));

/** Names that 0.5 replaced, and what replaced them. Startup refuses the old ones. */
const REPLACED: Record<string, string> = {
  REPOSITORY: "MICA_REPOSITORY_URL (the URL tells everything)",
  REPOSITORY_PROJECT: "MICA_REPOSITORY_URL, for example https://gitlab.com/group/project.git",
  REPOSITORY_API_BASE: "MICA_REPOSITORY_URL",
  REPOSITORY_TOKEN: "MICA_REPOSITORY_TOKEN",
  REPOSITORY_BRANCH: "MICA_REPOSITORY_BRANCH",
  REPOSITORY_ROOT: "MICA_REPOSITORY_ROOT",
  DATA_DIR: "MICA_DATA_DIR",
  DATABASE_PATH: "nothing: Mica 0.5 keeps no database",
};

const schema = z.object(fields).transform((env) => {
  const dataDir = path.resolve(env.MICA_DATA_DIR);
  const root = env.MICA_REPOSITORY_ROOT.replace(/^\/+|\/+$/g, "");
  const runtime = deriveRuntime({
    ...env,
    REPOSITORY: "git" as const,
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
    /** `MICA_*` and `REPOSITORY_*` names in the environment that nothing reads: likely typos. */
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

/** Git's rules for a branch name, enough to refuse anything that could act as an option or a range. */
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

/** The upgrade and repository problems, all at once — an operator fixes them in one pass. */
function repositoryProblems(env: NodeJS.ProcessEnv, development: boolean): { problems: string[]; repository?: RepositoryConfig } {
  const problems: string[] = [];

  const dataDir = path.resolve(env["MICA_DATA_DIR"] ?? env["DATA_DIR"] ?? "./data");
  if (existsSync(path.join(dataDir, "cms.sqlite"))) {
    problems.push(
      `${path.join(dataDir, "cms.sqlite")} is the draft database of Mica 0.4. Mica 0.5 keeps drafts in a Git clone\n` +
        "    and cannot read it. Start 0.4.1 again, publish or discard every pending change, stop it, then\n" +
        "    delete cms.sqlite. Drafts that you did not publish are lost when you delete it.",
    );
  }

  for (const [name, replacement] of Object.entries(REPLACED)) {
    if (env[name] !== undefined) problems.push(`${name} is no longer read. Use ${replacement}.`);
  }

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
  // Only when reading the ambient environment: tests pass an explicit object
  // and must not pick up whatever `.env` sits in the working directory.
  if (env === process.env) loadEnvFile();
  const present = withoutBlanks(env);

  const { problems, repository } = repositoryProblems(present, (present["NODE_ENV"] ?? "development") === "development");
  if (problems.length > 0) {
    throw new ConfigError(
      `Mica cannot start:\n${problems.map((problem) => `  - ${problem}`).join("\n")}\n` +
        "  See the upgrade notes for 0.5.0 and deploy/self-hosted/.env.example.",
    );
  }

  const parsed = schema.safeParse(present);
  if (!parsed.success) throw new ConfigError(describeConfigIssues(parsed.error));

  const config = parsed.data;

  requireAuthConfig(config);
  requireHttps(config, present);

  // Secrets are mandatory in production. In development an ephemeral one is
  // generated so a trial run works from a clean checkout — at the cost of
  // signing everyone out on restart, which is the correct trade-off there.
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
      .filter((name) => /^(MICA_|REPOSITORY_)/.test(name) && !KNOWN.has(name) && !(name in REPLACED))
      .sort(),
  };
}
