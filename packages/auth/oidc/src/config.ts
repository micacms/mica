/**
 * The auth gate's slice of the environment.
 *
 * A fragment, like the runtime's: the self-hosted app spreads `authEnv` into
 * its own schema, derives with `deriveAuth`, and passes the result here. The
 * local editor never touches any of this — these variables do not exist in
 * its configuration at all, which is a stronger statement than ignoring them.
 */

import { z } from "zod";

import { ConfigError, isLoopbackUrl, list } from "@micacms/runtime";

export const authEnv = {
  /**
   * OpenID Connect. Mica implements no passwords, no reset flow and no second
   * factor. It asks a provider who you are; the admission rules below decide
   * whether that person may edit this site.
   */
  MICA_OIDC_ISSUER: z.string().url().optional(),
  MICA_OIDC_CLIENT_ID: z.string().optional(),
  /** Omit for a public client using PKCE alone. `MICA_OIDC_CLIENT_SECRET_FILE` reads it from a file. */
  MICA_OIDC_CLIENT_SECRET: z.string().optional(),
  MICA_OIDC_SCOPE: z.string().default("openid profile email"),
  /**
   * Which claim carries the person's groups. There is no standard one:
   * Keycloak and Entra normally send `groups`, others send `roles`, and some
   * send whatever the operator mapped. Naming it here is what keeps
   * `MICA_ADMIT_GROUPS` working against any provider.
   */
  MICA_OIDC_GROUPS_CLAIM: z.string().default("groups"),

  /**
   * Who may edit this site. Authentication says who somebody is; these say
   * whether that person gets in. At least one is required — the composition
   * refuses to start without one. Comma-separated, all four.
   */
  MICA_ADMIT_GROUPS: z.string().optional(),
  MICA_ADMIT_DOMAINS: z.string().optional(),
  /** Verified addresses — the list for a provider with no groups, such as Google. */
  MICA_ADMIT_EMAILS: z.string().optional(),
  /** `issuer|subject` pairs — see admission.ts. */
  MICA_ADMIT_SUBJECTS: z.string().optional(),

  /**
   * Encrypts the session cookies. Required, also for a trial: a generated one
   * would sign everybody out at each restart. Rotating it ends every session.
   * `MICA_SESSION_SECRET_FILE` reads it from a file.
   */
  MICA_SESSION_SECRET: z.string({ error: "is required: generate one with `openssl rand -base64 48`" }).min(32),
  /**
   * Deliberately short. Admission is configuration and is re-read on every
   * request; what cannot be immediate is a change *at the provider*, which
   * Mica only sees at the next sign-in. The session lifetime is therefore the
   * upper bound on how long a revoked editor keeps working.
   */
  MICA_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(8),
  MICA_SESSION_IDLE_HOURS: z.coerce.number().int().positive().default(4),

  MICA_SIGNIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  /** Durations carry their unit in the name, in whole units: hours, minutes, seconds. */
  MICA_SIGNIN_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
};

const authSchema = z.object(authEnv);
export type AuthEnv = z.infer<typeof authSchema>;

/** The derived values the gate reads, on top of the parsed environment. */
export function deriveAuth<T extends AuthEnv & { MICA_PUBLIC_URL: string }>(env: T) {
  return {
    ...env,
    /** Discovery over plain HTTP, only for an identity provider on this machine, as in a trial or a test. */
    oidcAllowInsecure:
      env.MICA_OIDC_ISSUER?.startsWith("http://") === true && isLoopbackUrl(env.MICA_OIDC_ISSUER),
    admitGroups: list(env.MICA_ADMIT_GROUPS),
    // Lowercased: a domain is case-insensitive, and an operator who writes
    // `Example.com` means the same thing the provider spells `example.com`.
    admitDomains: list(env.MICA_ADMIT_DOMAINS).map((domain) =>
      domain.toLowerCase().replace(/^@/, ""),
    ),
    admitEmails: list(env.MICA_ADMIT_EMAILS).map((email) => email.toLowerCase()),
    admitSubjects: list(env.MICA_ADMIT_SUBJECTS).map((entry) => {
      const separator = entry.indexOf("|");
      return {
        issuer: separator < 0 ? "" : entry.slice(0, separator).trim(),
        subject: separator < 0 ? entry : entry.slice(separator + 1).trim(),
      };
    }),
    // Secure cookies are not sent over plain HTTP, which would break a
    // localhost trial run.
    cookieSecure: env.MICA_PUBLIC_URL.startsWith("https://"),
  };
}

/** What the gate requires of a finished configuration. */
export interface AuthConfig {
  MICA_PUBLIC_URL: string;
  MICA_OIDC_ISSUER?: string | undefined;
  MICA_OIDC_CLIENT_ID?: string | undefined;
  MICA_OIDC_CLIENT_SECRET?: string | undefined;
  MICA_OIDC_SCOPE: string;
  MICA_OIDC_GROUPS_CLAIM: string;
  oidcAllowInsecure: boolean;
  admitGroups: string[];
  admitDomains: string[];
  admitEmails: string[];
  admitSubjects: Array<{ issuer: string; subject: string }>;
  /** `MICA_SESSION_SECRET`, or the contents of `MICA_SESSION_SECRET_FILE`. */
  sessionSecret: string;
  cookieSecure: boolean;
  MICA_SESSION_TTL_HOURS: number;
  MICA_SESSION_IDLE_HOURS: number;
  MICA_SIGNIN_MAX_ATTEMPTS: number;
  MICA_SIGNIN_WINDOW_MINUTES: number;
}

/**
 * Domains where anybody can register an address. A domain rule naming one
 * admits the public, so it is refused; name the addresses instead.
 */
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "gmx.ch",
  "web.de",
]);

/**
 * The refusals that make a deployment honest before it serves a request.
 *
 * An OIDC deployment that admits every person its issuer knows is a
 * misconfiguration, not a default — see decisions.md.
 */
export function requireAuthConfig(config: {
  MICA_PUBLIC_URL: string;
  MICA_OIDC_ISSUER?: string | undefined;
  MICA_OIDC_CLIENT_ID?: string | undefined;
  admitGroups: string[];
  admitDomains: string[];
  admitEmails: string[];
  admitSubjects: Array<{ issuer: string; subject: string }>;
}): void {
  const needed = (["MICA_OIDC_ISSUER", "MICA_OIDC_CLIENT_ID"] as const).filter(
    (key) => !config[key],
  );

  if (needed.length > 0) {
    throw new ConfigError(
      `This deployment authenticates with OpenID Connect, so ` +
        `${needed.join(" and ")} must be set.\n` +
        "  Mica implements no passwords. Point it at Keycloak, Authentik,\n" +
        "  ZITADEL, Entra, Okta, Google — anything that speaks OIDC.\n" +
        `  The redirect URI to register is ${config.MICA_PUBLIC_URL}/api/auth/callback`,
    );
  }

  if (
    config.admitGroups.length === 0 &&
    config.admitDomains.length === 0 &&
    config.admitEmails.length === 0 &&
    config.admitSubjects.length === 0
  ) {
    throw new ConfigError(
      "Nothing says who may edit this site.\n" +
        "  Authentication is not admission: your provider will happily vouch for\n" +
        "  everybody it knows. Set at least one of these:\n\n" +
        "    MICA_ADMIT_GROUPS=mica-editors            a claim your provider sends\n" +
        "    MICA_ADMIT_DOMAINS=example.com            every verified address there\n" +
        "    MICA_ADMIT_EMAILS=alice@gmail.com        these verified addresses\n" +
        "    MICA_ADMIT_SUBJECTS=https://id.example.com|a1b2c3\n\n" +
        "  The group rule is the one to grow into: adding an editor is then a\n" +
        "  change in the identity provider, and Mica is not touched.",
    );
  }

  const open = config.admitDomains.filter((domain) => PUBLIC_EMAIL_DOMAINS.has(domain));
  if (open.length > 0) {
    throw new ConfigError(
      `MICA_ADMIT_DOMAINS names ${open.join(", ")}, where anybody can register an address.\n` +
        "  That rule would let the public edit this site. Name the people instead:\n" +
        "    MICA_ADMIT_EMAILS=alice@gmail.com,bob@gmail.com",
    );
  }

  const malformed = config.admitEmails.filter((email) => !/^[^@\s]+@[^@\s]+$/.test(email));
  if (malformed.length > 0) {
    throw new ConfigError(
      `MICA_ADMIT_EMAILS entries are email addresses, and these are not: ${malformed.join(", ")}`,
    );
  }

  const wrong = config.admitSubjects.filter((entry) => !entry.issuer || !entry.subject);
  if (wrong.length > 0) {
    throw new ConfigError(
      "MICA_ADMIT_SUBJECTS entries are `issuer|subject` pairs, and one is not:\n" +
        `    ${wrong.map((entry) => entry.subject || "(empty)").join(", ")}\n\n` +
        "  The issuer is part of the key because a subject is only unique within\n" +
        "  the provider that issued it. To admit an address, use MICA_ADMIT_EMAILS.\n" +
        `    MICA_ADMIT_SUBJECTS=${config.MICA_OIDC_ISSUER ?? "https://id.example.com"}|a1b2c3`,
    );
  }
}
