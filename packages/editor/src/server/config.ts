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

import { DEFAULT_BASE_URL, DEFAULT_PORT } from "./lib/ports.js";

/**
 * `.default` takes the *output* value in Zod 4, and short-circuits: an absent
 * variable returns the boolean without going through the transform. That is the
 * behaviour wanted here, and stating the fallback as a boolean is also what
 * makes the type check — `.default("true")` was a string on a boolean schema.
 */
const bool = (fallback: boolean) =>
  z
    .enum(["true", "false", "1", "0"])
    .transform((value) => value === "true" || value === "1")
    .default(fallback);

/** `a, b , c` and `a,b,c` are the same list, and an empty entry is not one. */
const list = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    LOG_LEVEL: z
      .enum(["debug", "info", "warn", "error", "silent"])
      .default("info"),

    /**
     * How this deployment is being run.
     *
     * One implementation, two shapes:
     *
     *   local        a developer's machine. No identity provider, and
     *                therefore no authentication and no user — see below.
     *   self-hosted  somebody's server. OIDC in front of one site.
     *
     * The mode is not cosmetic: it decides which configurations are allowed to
     * exist at all, which is why it is checked before anything starts.
     *
     * It is also temporary. The mode becomes which application you run, and
     * this variable disappears with the split into `apps/local-editor` and
     * `apps/self-hosted` — see docs/v3-plan.md, Phase C.
     */
    MICA_MODE: z.enum(["local", "self-hosted"]).default("local"),

    /**
     * The address to listen on.
     *
     * Defaulted per mode rather than globally: a container has to bind
     * `0.0.0.0` to be reachable at all, and a laptop running an
     * unauthenticated editor must not. Setting it explicitly still works —
     * except to a non-loopback address in local mode, which is refused below.
     */
    HOST: z.string().optional(),
    PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_PORT),

    /** Public origin of the CMS itself. Used for cookies, CORS and media URLs. */
    MICA_PUBLIC_URL: z.string().url().default(DEFAULT_BASE_URL),

    /**
     * Set by `npx @micacms/editor`, and by nothing else.
     *
     * The audience for the startup output: a person at a terminal gets one
     * banner, a log collector gets the structured lines. Neither is a mode —
     * everything else about the server is identical.
     */
    MICA_CLI: bool(false),
    /** Whether that front door should open a browser once it is listening. */
    MICA_OPEN: bool(false),

    /**
     * The content repository this Mica serves, when it reaches it as a working
     * tree on disk. Ignored for a provider connector, which is given
     * REPOSITORY_ROOT inside the remote repository instead.
     *
     * Content and media live here, and Git is what makes them durable. Mica's
     * own database holds sessions only — losing it must never mean losing
     * website content.
     *
     * The default is the example project in this repository, which is what
     * `pnpm dev` edits.
     */
    CONTENT_ROOT: z.string().default("../../sites/muster-consulting/content"),

    /**
     * How Mica reaches that repository.
     *
     * `local` writes into a working tree beside the server: right for
     * development and for a self-hosted deployment that already has a checkout
     * and its own way of committing. `github` and `gitlab` commit through the
     * provider's API, which is what a hosted Mica needs — no clone, no
     * credentials on disk, and every save is a commit an editor's colleague can
     * review.
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

    /** Operational state only: sessions. */
    DATA_DIR: z.string().default("./data"),
    DATABASE_PATH: z.string().optional(),

    /**
     * OpenID Connect. Required outside local mode.
     *
     * Mica implements no passwords, no reset flow and no second factor. It
     * asks a provider who you are; the admission rules below decide whether
     * that person may edit this site.
     */
    MICA_OIDC_ISSUER: z.string().url().optional(),
    MICA_OIDC_CLIENT_ID: z.string().optional(),
    /** Omit for a public client using PKCE alone. */
    MICA_OIDC_CLIENT_SECRET: z.string().optional(),
    MICA_OIDC_SCOPE: z.string().default("openid profile email"),
    /**
     * Which claim carries the person's groups.
     *
     * There is no standard one. Keycloak and Entra normally send `groups`,
     * others send `roles`, and some send whatever the operator mapped. Naming
     * it here is what keeps `MICA_ADMIT_GROUP` working against any provider
     * without provider-specific code.
     */
    MICA_OIDC_GROUPS_CLAIM: z.string().default("groups"),

    /* ------------------------------------------------------- admission */

    /**
     * Who may edit this site. Authentication says who somebody is; these say
     * whether that person gets in. At least one is required outside local mode.
     *
     * A rule over claims is the normal path — adding an editor is then a group
     * change in the identity provider, and Mica is not touched. The subject
     * list is the escape hatch for a provider with no groups, and for the first
     * sign-in before a group exists.
     *
     * Comma-separated, all three.
     */
    MICA_ADMIT_GROUP: z.string().optional(),
    MICA_ADMIT_DOMAIN: z.string().optional(),
    /** `issuer|subject` pairs. Never an email — see services/admission.ts. */
    MICA_ADMIT_SUBJECTS: z.string().optional(),

    /** Signs session cookies. Rotating it invalidates every session. */
    SESSION_SECRET: z.string().min(32).optional(),
    /**
     * Deliberately short.
     *
     * Admission is configuration and is re-read on every request, so removing
     * somebody from `MICA_ADMIT_SUBJECTS` takes effect at once. Removing them
     * from a *group at the provider* does not: Mica sees the claims the
     * provider sent at sign-in, and only learns better at the next one. The
     * session lifetime is therefore the upper bound on how long a revoked
     * editor keeps working, which is why it is hours rather than weeks.
     */
    SESSION_TTL_HOURS: z.coerce.number().int().positive().default(8),
    SESSION_IDLE_HOURS: z.coerce.number().int().positive().default(4),

    MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(25 * 1024 * 1024),

    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
    LOGIN_WINDOW_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),

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
      HOST: env.HOST ?? (env.MICA_MODE === "local" ? "127.0.0.1" : "0.0.0.0"),
      isProduction: env.NODE_ENV === "production",
      dataDir,
      databasePath: path.resolve(
        env.DATABASE_PATH ?? path.join(dataDir, "cms.sqlite"),
      ),
      contentRoot: path.resolve(env.CONTENT_ROOT),
      /**
       * Local mode has no identity provider, and therefore no authentication
       * and nobody to be. Kept as a derived flag so that the places which must
       * refuse it read as a question about authentication rather than a string
       * comparison on the mode.
       */
      authDisabled: env.MICA_MODE === "local",
      /**
       * Discovery over plain HTTP, for an identity provider running on
       * localhost. Never in production, and never for a remote host.
       */
      oidcAllowInsecure:
        env.NODE_ENV !== "production" &&
        /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(
          env.MICA_OIDC_ISSUER ?? "",
        ),
      admitGroups: list(env.MICA_ADMIT_GROUP),
      // Lowercased: a domain is case-insensitive, and an operator who writes
      // `Example.com` means the same thing the provider spells `example.com`.
      admitDomains: list(env.MICA_ADMIT_DOMAIN).map((domain) =>
        domain.toLowerCase().replace(/^@/, ""),
      ),
      admitSubjects: list(env.MICA_ADMIT_SUBJECTS).map((entry) => {
        const separator = entry.indexOf("|");
        return {
          issuer: separator < 0 ? "" : entry.slice(0, separator).trim(),
          subject: separator < 0 ? entry : entry.slice(separator + 1).trim(),
        };
      }),
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

/** Hostnames that are this machine, and nowhere else. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0:0:0:0:0:0:0:1"]);

/**
 * Folds `./.env` into the ambient environment.
 *
 * `process.loadEnvFile` leaves already-set variables alone, so a container's
 * `environment:` block still beats a file that happened to be copied into the
 * image. Resolved against the working directory, like `DATA_DIR` above, which
 * is `packages/editor` for every documented way of starting the server.
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
    Object.entries(env).filter(
      ([, value]) => value !== undefined && value.trim() !== "",
    ),
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

  /**
   * Local mode disables authentication. It must never be reachable.
   *
   * This is the single most dangerous configuration Mica can be in, so it is
   * refused at the three points where it stops being a developer's
   * convenience: a production build, a base URL that is not the local machine,
   * and a listening address that is not the local machine either.
   */
  if (config.MICA_MODE === "local") {
    if (config.isProduction) {
      throw new ConfigError(
        "MICA_MODE=local disables authentication, and NODE_ENV=production.\n" +
          "  Local mode has no identity provider and no user: every request is\n" +
          "  allowed. Set MICA_MODE=self-hosted and configure MICA_OIDC_ISSUER /\n" +
          "  MICA_OIDC_CLIENT_ID.",
      );
    }

    const host = new URL(config.MICA_PUBLIC_URL).hostname;
    if (!LOOPBACK.has(host)) {
      throw new ConfigError(
        `MICA_MODE=local disables authentication, but MICA_PUBLIC_URL points at "${host}".\n` +
          "  Local mode is for a developer's own machine only. Anything reachable\n" +
          "  by anyone else needs MICA_MODE=self-hosted and an identity provider.",
      );
    }

    /**
     * The same rule for the socket.
     *
     * A base URL saying `localhost` while the process listens on `0.0.0.0`
     * leaves an unauthenticated editor open to the whole network, and the URL
     * check above would have said nothing about it. There is deliberately no
     * override: remote access is what self-hosted mode is.
     */
    if (!LOOPBACK.has(config.HOST) && config.HOST !== "::1") {
      throw new ConfigError(
        `MICA_MODE=local disables authentication, but HOST is "${config.HOST}".\n` +
          "  Local mode binds to the loopback address and nothing else. Use\n" +
          "  HOST=127.0.0.1, or run MICA_MODE=self-hosted with an identity provider.",
      );
    }
  } else {
    const needed = (["MICA_OIDC_ISSUER", "MICA_OIDC_CLIENT_ID"] as const).filter(
      (key) => !config[key],
    );

    if (needed.length > 0) {
      throw new ConfigError(
        `MICA_MODE=${config.MICA_MODE} authenticates with OpenID Connect, so ` +
          `${needed.join(" and ")} must be set.\n` +
          "  Mica implements no passwords. Point it at Keycloak, Authentik,\n" +
          "  ZITADEL, Entra, Okta, Google — anything that speaks OIDC.\n" +
          `  The redirect URI to register is ${config.MICA_PUBLIC_URL}/api/auth/callback`,
      );
    }

    /**
     * An OIDC deployment that admits every person its issuer knows is a
     * misconfiguration, not a default.
     *
     * A provider vouches for a whole company; nothing in a valid ID token says
     * the holder may edit this website. With no rule at all Mica would have to
     * choose between admitting everyone and admitting no one, and both are
     * wrong in a way the operator would only find out afterwards.
     */
    if (
      config.admitGroups.length === 0 &&
      config.admitDomains.length === 0 &&
      config.admitSubjects.length === 0
    ) {
      throw new ConfigError(
        "MICA_MODE=self-hosted, and nothing says who may edit this site.\n" +
          "  Authentication is not admission: your provider will happily vouch for\n" +
          "  everybody it knows. Set at least one of these:\n\n" +
          "    MICA_ADMIT_GROUP=mica-editors            a claim your provider sends\n" +
          "    MICA_ADMIT_DOMAIN=example.com            every verified address there\n" +
          "    MICA_ADMIT_SUBJECTS=https://id.example.com|a1b2c3\n\n" +
          "  The group rule is the one to grow into: adding an editor is then a\n" +
          "  change in the identity provider, and Mica is not touched.",
      );
    }

    const wrong = config.admitSubjects.filter((entry) => !entry.issuer || !entry.subject);
    if (wrong.length > 0) {
      throw new ConfigError(
        "MICA_ADMIT_SUBJECTS entries are `issuer|subject` pairs, and one is not:\n" +
          `    ${wrong.map((entry) => entry.subject || "(empty)").join(", ")}\n\n` +
          "  The issuer is part of the key because a subject is only unique within\n" +
          "  the provider that issued it. It is never an email address: providers\n" +
          "  let people change those, and two people can hold one in turn.\n" +
          `    MICA_ADMIT_SUBJECTS=${config.MICA_OIDC_ISSUER ?? "https://id.example.com"}|a1b2c3`,
      );
    }
  }

  /**
   * A remote repository needs to be told which one, and with what.
   *
   * Checked here rather than at the first save: a Mica that starts, shows the
   * editor their content, and only fails when they press Save has already
   * wasted their work.
   */
  if (config.REPOSITORY !== "local") {
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

  const sessionSecret =
    config.SESSION_SECRET ?? randomBytes(32).toString("hex");

  return {
    ...config,
    sessionSecret,
    // Secure cookies are not sent over plain HTTP, which would break local dev.
    cookieSecure: config.MICA_PUBLIC_URL.startsWith("https://"),
    devSecrets: missing,
  } as Config & { devSecrets: string[] };
}
