/**
 * Environment configuration.
 *
 * Parsed once at startup and validated with Zod so a misconfigured deployment
 * fails immediately with a readable message, rather than at the first request
 * that happens to need the missing value.
 */

import { randomBytes } from "node:crypto";
import path from "node:path";
import { z } from "zod";

const bool = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .transform((value) => value === "true" || value === "1")
    .default(fallback ? "true" : "false");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error", "silent"]).default("info"),

    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),

    /** Public origin of the CMS itself. Used for cookies, CORS and media URLs. */
    CMS_BASE_URL: z.string().url().default("http://localhost:4000"),

    /**
     * The content repository this Mica serves.
     *
     * Content and media live here, and Git is what makes them durable. Mica's
     * own database holds users and sessions only — losing it must never mean
     * losing website content.
     */
    CONTENT_ROOT: z.string().default("../../content"),

    /** Operational state only: users and sessions. */
    DATA_DIR: z.string().default("./data"),
    DATABASE_PATH: z.string().optional(),

    /**
     * The project's compiled content model — the file the server is a CMS *for*.
     *
     * The image ships without one, so this is required in production. In
     * development it falls back to the `mica.config.ts` in the repository root,
     * which `tsx` can load directly and which is also what the example website
     * imports.
     */
    MICA_SCHEMA: z.string().optional(),

    /** Signs session cookies. Rotating it invalidates every session. */
    SESSION_SECRET: z.string().min(32).optional(),
    SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 14),
    SESSION_IDLE_HOURS: z.coerce.number().int().positive().default(24 * 3),

    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),

    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
    LOGIN_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),

    /** Read the client IP from X-Forwarded-For. Only enable behind a proxy. */
    TRUST_PROXY: bool(false),
    /** Extra browser origins allowed to call the admin API (dev Vite server). */
    ADMIN_ORIGINS: z.string().optional(),
    /** Overrides where the built admin SPA is served from. */
    ADMIN_DIR: z.string().optional(),
  })
  .transform((env) => {
    const dataDir = path.resolve(env.DATA_DIR);
    return {
      ...env,
      isProduction: env.NODE_ENV === "production",
      // `../..` is the repository root from `apps/cms`, the working directory
      // for every documented way of starting the server in development.
      schemaPath: path.resolve(env.MICA_SCHEMA ?? "../../mica.config.ts"),
      dataDir,
      databasePath: path.resolve(env.DATABASE_PATH ?? path.join(dataDir, "cms.sqlite")),
      contentRoot: path.resolve(env.CONTENT_ROOT),
      adminOrigins: (env.ADMIN_ORIGINS ?? "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    };
  });

export type Config = z.infer<typeof schema> & {
  sessionSecret: string;
  cookieSecure: boolean;
};

export class ConfigError extends Error {
  override name = "ConfigError";
}

/**
 * Folds `./.env` into the ambient environment.
 *
 * `process.loadEnvFile` leaves already-set variables alone, so a container's
 * `environment:` block still beats a file that happened to be copied into the
 * image. Resolved against the working directory, like `DATA_DIR` above, which
 * is `apps/cms` for every documented way of starting the server.
 */
function loadEnvFile(): void {
  try {
    process.loadEnvFile();
  } catch (error) {
    // No `.env` is the normal case in production, where the platform injects
    // the values directly. Anything else — unreadable, malformed — is a real
    // misconfiguration, and silently starting with default secrets is exactly
    // the failure this module exists to prevent.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new ConfigError(`Could not read .env: ${(error as Error).message}`);
    }
  }
}

/**
 * An unset variable and one set to the empty string mean the same thing.
 *
 * `.env.example` ships `SESSION_SECRET=` and friends as blanks for the operator
 * to fill in, and the README says to copy it verbatim. Without this, doing so
 * reads as "the session secret is a zero-length string" and the server refuses
 * to start on the documented happy path.
 */
function withoutBlanks(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Only when reading the ambient environment: the tests pass an explicit
  // object and must not pick up whatever `.env` sits in the working directory.
  if (env === process.env) loadEnvFile();

  const parsed = schema.safeParse(withoutBlanks(env));

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new ConfigError(`Invalid environment configuration:\n${details}`);
  }

  const config = parsed.data;

  // Secrets are mandatory in production. In development we generate ephemeral
  // ones so `pnpm dev` works from a clean checkout — at the cost of logging
  // everyone out on restart, which is the correct trade-off locally.
  const missing: string[] = [];
  if (!config.SESSION_SECRET) missing.push("SESSION_SECRET");

  if (config.isProduction && missing.length > 0) {
    throw new ConfigError(
      `Missing required production secrets: ${missing.join(", ")}.\n` +
        `Generate them with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }

  // The development fallback is a TypeScript file in the repository root, which
  // only resolves under `tsx`. A production image has neither, so requiring the
  // variable there turns "no collections appear in the admin" into a startup
  // error that says what is missing.
  if (config.isProduction && !config.MICA_SCHEMA) {
    throw new ConfigError(
      "MICA_SCHEMA is not set.\n" +
        "  The CMS image ships without a content model — it has to be given one.\n" +
        "  Compile the project's mica.config.ts with `pnpm build:schema`, mount the\n" +
        "  result into the container, and point MICA_SCHEMA at it:\n" +
        "    volumes:     [ ./mica.config.js:/app/schema.js:ro ]\n" +
        "    environment: { MICA_SCHEMA: /app/schema.js }",
    );
  }

  const sessionSecret = config.SESSION_SECRET ?? randomBytes(32).toString("hex");

  return {
    ...config,
    sessionSecret,
    // Secure cookies are not sent over plain HTTP, which would break local dev.
    cookieSecure: config.CMS_BASE_URL.startsWith("https://"),
    devSecrets: missing,
  } as Config & { devSecrets: string[] };
}
