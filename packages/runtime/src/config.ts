/**
 * The runtime's slice of the environment, as a fragment.
 *
 * There is no `loadConfig` here, deliberately. The runtime is composed by an
 * app — the local editor, the self-hosted container — and which variables
 * exist, which are refused and what the defaults are is exactly what makes
 * one app not the other. Each app builds its own Zod schema from this shape,
 * adds its own variables, and derives a `RuntimeConfig` with `deriveRuntime`;
 * this module only states what the runtime itself reads.
 *
 * `MICA_MODE` is gone. The mode is which app you run.
 */

import path from "node:path";
import { z } from "zod";

import { DEFAULT_BASE_URL, DEFAULT_PORT } from "./lib/ports.js";

/**
 * `.default` takes the *output* value in Zod 4, and short-circuits: an absent
 * variable returns the boolean without going through the transform.
 */
export const bool = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .transform((value) => value === "true" || value === "1")
    .default(fallback);

/** `a, b , c` and `a,b,c` are the same list, and an empty entry is not one. */
export const list = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Hostnames that are this machine, and nowhere else. */
export const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0:0:0:0:0:0:0:1"]);

/** The variables the runtime itself reads. Apps spread this into their schema. */
export const runtimeEnv = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),

  /** The address to listen on. Defaulted by the app: loopback for the local
   *  editor (which refuses anything else), every interface for a container. */
  HOST: z.string().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_PORT),

  /** Public origin of the CMS itself. Used for cookies, CORS and media URLs. */
  MICA_PUBLIC_URL: z.string().url().default(DEFAULT_BASE_URL),

  /**
   * The content repository this Mica serves, when it reaches it as a working
   * tree on disk. Ignored for a provider connector, which is given
   * REPOSITORY_ROOT inside the remote repository instead.
   */
  CONTENT_ROOT: z.string().default("../../examples/muster-consulting/content"),

  /**
   * How Mica reaches that repository. `local` is a working tree beside the
   * server — and the working tree is then the draft workspace. `github` and
   * `gitlab` publish through the provider's API, with saves staged in the
   * draft store until an editor publishes.
   */
  REPOSITORY: z.enum(["local", "github", "gitlab"]).default("local"),
  /** Where the content root sits *inside* the remote repository. */
  REPOSITORY_ROOT: z.string().default("content"),
  REPOSITORY_BRANCH: z.string().default("main"),
  /** Token with write access to the content repository. */
  REPOSITORY_TOKEN: z.string().optional(),
  /** `owner/repo` for GitHub, `group/project` or a numeric id for GitLab. */
  REPOSITORY_PROJECT: z.string().optional(),
  /** For GitHub Enterprise or self-managed GitLab. */
  REPOSITORY_API_BASE: z.string().url().optional(),

  /**
   * Whether working-tree staging may commit and push. `false` reduces Publish
   * to autosave plus a read-only view of the pending changes.
   */
  MICA_LOCAL_PUBLISH: bool(true),

  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(25 * 1024 * 1024),

  /** Read the client IP from X-Forwarded-For. Only enable behind a proxy. */
  TRUST_PROXY: bool(false),
  /** Extra browser origins allowed to call the admin API (dev Vite server). */
  ADMIN_ORIGINS: z.string().optional(),
  /** Overrides where the built admin SPA is served from. */
  ADMIN_DIR: z.string().optional(),
};

const runtimeSchema = z.object(runtimeEnv);
export type RuntimeEnv = z.infer<typeof runtimeSchema>;

/**
 * The derived values the runtime reads, on top of the parsed environment.
 *
 * Called from each app's own `transform`, so every composition derives them
 * the same way and none forgets one.
 */
export function deriveRuntime<T extends RuntimeEnv>(env: T) {
  return {
    ...env,
    isProduction: env.NODE_ENV === "production",
    contentRoot: path.resolve(env.CONTENT_ROOT),
    adminOrigins: list(env.ADMIN_ORIGINS),
  };
}

/** What the runtime requires of a finished configuration. */
export type RuntimeConfig = ReturnType<typeof deriveRuntime<RuntimeEnv>> & {
  /** Resolved by the app: the runtime never guesses an address. */
  HOST: string;
};

/**
 * A remote repository needs to be told which one, and with what.
 *
 * Checked at startup rather than at the first save: a Mica that starts, shows
 * the editor their content, and only fails when they press Save has already
 * wasted their work.
 */
export function requireRepositoryConfig(config: RuntimeConfig): void {
  if (config.REPOSITORY === "local") return;

  const needed = (["REPOSITORY_PROJECT", "REPOSITORY_TOKEN"] as const).filter(
    (key) => !config[key],
  );

  if (needed.length > 0) {
    throw new ConfigError(
      `REPOSITORY is "${config.REPOSITORY}", so ${needed.join(" and ")} must be set.\n` +
        (config.REPOSITORY === "github"
          ? "  REPOSITORY_PROJECT is owner/repo, and the token needs contents: write."
          : "  REPOSITORY_PROJECT is group/project or a numeric id, and the token needs\n" +
            "  the write_repository scope."),
    );
  }
}

/**
 * Folds `./.env` into the ambient environment.
 *
 * `process.loadEnvFile` leaves already-set variables alone, so a container's
 * `environment:` block still beats a file that happened to be copied into the
 * image.
 */
export function loadEnvFile(): void {
  try {
    process.loadEnvFile();
  } catch (error) {
    // No `.env` is the normal case in production. Anything else — unreadable,
    // malformed — is a real misconfiguration, and silently starting with
    // default secrets is exactly the failure config exists to prevent.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ConfigError(`Could not read .env: ${(error as Error).message}`);
    }
  }
}

/**
 * An unset variable and one set to the empty string mean the same thing.
 *
 * `.env.example` ships blanks for the operator to fill in, and the docs say to
 * copy it verbatim; without this, doing so reads as "the secret is a
 * zero-length string" and the server refuses on the documented happy path.
 */
export function withoutBlanks(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
}

/** Formats a Zod refusal the way a person at a terminal reads it. */
export function describeConfigIssues(error: z.ZodError): string {
  const details = error.issues
    .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  return `Invalid environment configuration:\n${details}`;
}
