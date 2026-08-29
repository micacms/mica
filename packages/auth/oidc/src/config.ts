/**
 * The auth gate's slice of the environment.
 *
 * A fragment, like the runtime's: the self-hosted app spreads `authEnv` into
 * its own schema, derives with `deriveAuth`, and passes the result here. The
 * local editor never touches any of this — these variables do not exist in
 * its configuration at all, which is a stronger statement than ignoring them.
 */

import { z } from "zod";

import { ConfigError, list } from "@micacms/runtime";

export const authEnv = {
  /**
   * OpenID Connect. Mica implements no passwords, no reset flow and no second
   * factor. It asks a provider who you are; the admission rules below decide
   * whether that person may edit this site.
   */
  MICA_OIDC_ISSUER: z.string().url().optional(),
  MICA_OIDC_CLIENT_ID: z.string().optional(),
  /** Omit for a public client using PKCE alone. */
  MICA_OIDC_CLIENT_SECRET: z.string().optional(),
  MICA_OIDC_SCOPE: z.string().default("openid profile email"),
  /**
   * Which claim carries the person's groups. There is no standard one:
   * Keycloak and Entra normally send `groups`, others send `roles`, and some
   * send whatever the operator mapped. Naming it here is what keeps
   * `MICA_ADMIT_GROUP` working against any provider.
   */
  MICA_OIDC_GROUPS_CLAIM: z.string().default("groups"),

  /**
   * Who may edit this site. Authentication says who somebody is; these say
   * whether that person gets in. At least one is required — the composition
   * refuses to start without one. Comma-separated, all three.
   */
  MICA_ADMIT_GROUP: z.string().optional(),
  MICA_ADMIT_DOMAIN: z.string().optional(),
  /** `issuer|subject` pairs. Never an email — see admission.ts. */
  MICA_ADMIT_SUBJECTS: z.string().optional(),

  /** Signs session cookies. Rotating it invalidates every session. */
  SESSION_SECRET: z.string().min(32).optional(),
  /**
   * Deliberately short. Admission is configuration and is re-read on every
   * request; what cannot be immediate is a change *at the provider*, which
   * Mica only sees at the next sign-in. The session lifetime is therefore the
   * upper bound on how long a revoked editor keeps working.
   */
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(8),
  SESSION_IDLE_HOURS: z.coerce.number().int().positive().default(4),

  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  LOGIN_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
};

const authSchema = z.object(authEnv);
export type AuthEnv = z.infer<typeof authSchema>;

/** The derived values the gate reads, on top of the parsed environment. */
export function deriveAuth<T extends AuthEnv & { NODE_ENV: string; MICA_PUBLIC_URL: string }>(
  env: T,
) {
  return {
    ...env,
    /**
     * Discovery over plain HTTP, for an identity provider running on
     * localhost. Never in production, and never for a remote host.
     */
    oidcAllowInsecure:
      env.NODE_ENV !== "production" &&
      /^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(env.MICA_OIDC_ISSUER ?? ""),
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
    // Secure cookies are not sent over plain HTTP, which would break a
    // localhost trial run.
    cookieSecure: env.MICA_PUBLIC_URL.startsWith("https://"),
  };
}

/** What the gate requires of a finished configuration. */
export interface AuthConfig {
  MICA_PUBLIC_URL: string;
  isProduction: boolean;
  MICA_OIDC_ISSUER?: string | undefined;
  MICA_OIDC_CLIENT_ID?: string | undefined;
  MICA_OIDC_CLIENT_SECRET?: string | undefined;
  MICA_OIDC_SCOPE: string;
  MICA_OIDC_GROUPS_CLAIM: string;
  oidcAllowInsecure: boolean;
  admitGroups: string[];
  admitDomains: string[];
  admitSubjects: Array<{ issuer: string; subject: string }>;
  /** Resolved by the app: mandatory in production, ephemeral in development. */
  sessionSecret: string;
  cookieSecure: boolean;
  SESSION_TTL_HOURS: number;
  SESSION_IDLE_HOURS: number;
  LOGIN_MAX_ATTEMPTS: number;
  LOGIN_WINDOW_MS: number;
}

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
    config.admitSubjects.length === 0
  ) {
    throw new ConfigError(
      "Nothing says who may edit this site.\n" +
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
