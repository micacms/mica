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

/** Whether a URL points at this machine: then plain HTTP is allowed, for a trial or a test. */
export function isLoopbackUrl(url: string): boolean {
  return LOOPBACK.has(new URL(url).hostname.replace(/^\[|\]$/g, ""));
}

/** The variables the runtime itself reads. Apps spread this into their schema. */
export const runtimeEnv = {
  MICA_LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),

  /** The listen address. The app sets the default. */
  HOST: z.string().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_PORT),

  /** Public origin of the CMS itself, without a path. Used for cookies, CORS and media URLs. */
  MICA_PUBLIC_URL: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return url.pathname === "/" && !url.search && !url.hash;
    }, "must be an origin such as https://cms.example.com, without a path")
    .transform((value) => new URL(value).origin)
    .default(DEFAULT_BASE_URL),

  /** The content root this Mica serves: a directory in a Git working tree. Each app sets it. */
  MICA_CONTENT_ROOT: z.string(),

  /** `false` disables commit and push: Publish shows the pending changes read-only. */
  MICA_LOCAL_PUBLISH: bool(true),

  MICA_MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(25 * 1024 * 1024),

  /** Read the client IP from X-Forwarded-For. Only enable behind a proxy. */
  MICA_TRUST_PROXY: bool(false),
  /** Agents connected over MCP get the `publish` tool. Off: they save drafts, and a person publishes them. */
  MICA_MCP_PUBLISH: bool(false),
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
    /** The public URL is this machine: a trial or a test, where plain HTTP and curl are allowed. */
    isLoopback: isLoopbackUrl(env.MICA_PUBLIC_URL),
    contentRoot: path.resolve(env.MICA_CONTENT_ROOT),
    /** More browser origins for the admin API: only the local editor's development setting fills it. */
    adminOrigins: [] as string[],
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
