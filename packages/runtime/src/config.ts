/**
 * The environment variables the runtime reads. There is no `loadConfig`: each
 * app builds its own schema from `runtimeEnv`, because the variables and
 * defaults are what make one app different from another.
 */

import path from "node:path";
import { z } from "zod";

import { DEFAULT_BASE_URL, DEFAULT_PORT } from "./lib/ports.js";

/** In Zod 4, `.default` takes the output value and skips the transform. */
export const bool = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .transform((value) => value === "true" || value === "1")
    .default(fallback);

/** Splits a comma-separated list, trims entries and drops empty ones. */
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

  /** The listen address. The app sets the default. */
  HOST: z.string().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_PORT),

  /** Public origin of the CMS itself. Used for cookies, CORS and media URLs. */
  MICA_PUBLIC_URL: z.string().url().default(DEFAULT_BASE_URL),

  /** The content root this Mica serves: a directory in a Git working tree. */
  CONTENT_ROOT: z.string().default("../../examples/muster-consulting/content"),

  /** `false` disables commit and push: Publish shows the pending changes read-only. */
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
 * Adds the derived values to the parsed environment. Each app calls it from its
 * own `transform`.
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

/** Loads `./.env` into `process.env`. Variables that are already set win. */
export function loadEnvFile(): void {
  try {
    process.loadEnvFile();
  } catch (error) {
    // A missing `.env` is normal; an unreadable or malformed one must not start
    // the server with defaults.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ConfigError(`Could not read .env: ${(error as Error).message}`);
    }
  }
}

/** Treats a blank variable as unset, so a verbatim copy of `.env.example` with blanks is valid. */
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
