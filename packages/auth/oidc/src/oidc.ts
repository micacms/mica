/**
 * OpenID Connect.
 *
 * Mica does not authenticate anybody. It asks a provider who you are, and
 * records the answer. Hashing, reset flows, MFA, passkeys and breach response
 * all belong to the identity provider, and none of them are Mica's to get
 * wrong.
 *
 * What is Mica's is the small part here: run the authorization code flow
 * correctly and report what the provider said. Whether that person may edit
 * this site is `services/admission.ts`, and deliberately not a table.
 *
 * Three checks carry the security of the flow, and all three are enforced
 * rather than assumed:
 *
 *   - **PKCE** binds the authorization code to this browser, so a code
 *     intercepted in a redirect is useless to anyone else.
 *   - **state** binds the callback to a request Mica actually started, which
 *     is what stops an attacker feeding a victim their own login.
 *   - **nonce** binds the ID token to that same request, so a token replayed
 *     from elsewhere does not validate.
 *
 * They are carried in a short-lived signed cookie rather than in the database:
 * the transaction lasts one redirect, and a table of them would be a table of
 * garbage to collect.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import * as client from "openid-client";

import { ApiError, type Logger } from "@micacms/runtime";

import type { AuthConfig } from "./config.js";

/**
 * How long a sign-in may take.
 *
 * Long enough to enter a second factor and read an email; short enough that an
 * abandoned transaction cookie is not a lasting liability.
 */
const TRANSACTION_TTL_MS = 15 * 60 * 1000;

export interface OidcTransaction {
  state: string;
  nonce: string;
  verifier: string;
  /** Where to send the browser once the session exists. */
  returnTo: string;
  expiresAt: number;
}

/** What the provider told us about the person signing in. */
export interface OidcClaims {
  issuer: string;
  subject: string;
  email: string;
  /** The provider's `email_verified`. Absent counts as false, never as true. */
  emailVerified: boolean;
  name: string;
  /** The configured groups claim, or empty when the provider sends none. */
  groups: string[];
}

/* ------------------------------------------------------------------ *
 * The transaction cookie
 * ------------------------------------------------------------------ */

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function sealTransaction(transaction: OidcTransaction, secret: string): string {
  const payload = Buffer.from(JSON.stringify(transaction)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function openTransaction(cookie: string, secret: string): OidcTransaction | null {
  const separator = cookie.lastIndexOf(".");
  if (separator < 1) return null;

  const payload = cookie.slice(0, separator);
  const signature = cookie.slice(separator + 1);

  if (!safeEqual(signature, sign(payload, secret))) return null;

  try {
    const transaction = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as OidcTransaction;

    return transaction.expiresAt > Date.now() ? transaction : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * The service
 * ------------------------------------------------------------------ */

export interface OidcServiceDeps {
  config: AuthConfig;
  logger: Logger;
}

export function createOidcService(deps: OidcServiceDeps) {
  const { config, logger } = deps;

  const redirectUri = new URL("/api/auth/callback", config.MICA_PUBLIC_URL).toString();

  /**
   * Discovery, done once and remembered.
   *
   * Lazy rather than at startup: an identity provider that is briefly
   * unreachable should delay the first sign-in, not stop Mica from booting and
   * taking its health check down with it.
   */
  let discovered: Promise<client.Configuration> | null = null;

  function configuration(): Promise<client.Configuration> {
    discovered ??= client
      .discovery(
        new URL(config.MICA_OIDC_ISSUER!),
        config.MICA_OIDC_CLIENT_ID!,
        config.MICA_OIDC_CLIENT_SECRET,
        undefined,
        // Only ever for a provider on localhost, and only outside production —
        // the config layer refuses the combination anywhere else.
        config.oidcAllowInsecure ? { execute: [client.allowInsecureRequests] } : undefined,
      )
      .catch((error: unknown) => {
        // Forget the failure so the next attempt retries rather than caching a
        // rejected promise for the life of the process.
        discovered = null;
        logger.error("OIDC discovery failed", {
          issuer: config.MICA_OIDC_ISSUER,
          error: String(error),
        });
        throw new ApiError(
          "service_unavailable",
          "The identity provider could not be reached. Try again shortly.",
        );
      });

    return discovered;
  }

  return {
    /** Where to send a browser to sign in, plus the transaction to remember. */
    async begin(returnTo: string): Promise<{ url: string; transaction: OidcTransaction }> {
      const as = await configuration();

      const verifier = client.randomPKCECodeVerifier();
      const transaction: OidcTransaction = {
        state: client.randomState(),
        nonce: client.randomNonce(),
        verifier,
        returnTo,
        expiresAt: Date.now() + TRANSACTION_TTL_MS,
      };

      const url = client.buildAuthorizationUrl(as, {
        redirect_uri: redirectUri,
        scope: config.MICA_OIDC_SCOPE,
        state: transaction.state,
        nonce: transaction.nonce,
        code_challenge: await client.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
      });

      return { url: url.toString(), transaction };
    },

    /**
     * Completes the flow and returns who signed in.
     *
     * `authorizationCodeGrant` verifies the ID token signature, the issuer, the
     * audience, the expiry, the nonce and the PKCE verifier. Doing any of that
     * by hand here would be reimplementing the part of this that is genuinely
     * hard to get right.
     */
    async complete(currentUrl: URL, transaction: OidcTransaction): Promise<OidcClaims> {
      const as = await configuration();

      let tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers;
      try {
        tokens = await client.authorizationCodeGrant(as, currentUrl, {
          pkceCodeVerifier: transaction.verifier,
          expectedState: transaction.state,
          expectedNonce: transaction.nonce,
        });
      } catch (error) {
        logger.warn("OIDC callback rejected", { error: String(error) });
        throw new ApiError("unauthenticated", "Sign-in could not be completed. Please try again.");
      }

      const claims = tokens.claims();
      if (!claims?.sub) {
        throw new ApiError("unauthenticated", "The identity provider returned no subject.");
      }

      // Not every provider puts email, name and groups in the ID token; some
      // keep them at the userinfo endpoint, and some only release groups
      // there. Ask only when something is missing.
      const groupsClaim = config.MICA_OIDC_GROUPS_CLAIM;

      let email = typeof claims["email"] === "string" ? claims["email"] : "";
      let name = typeof claims["name"] === "string" ? claims["name"] : "";
      let emailVerified = claims["email_verified"] === true;
      let groups = readGroups(claims[groupsClaim]);

      if (!email || !name || groups.length === 0) {
        try {
          const info = await client.fetchUserInfo(as, tokens.access_token, claims.sub);
          email ||= typeof info.email === "string" ? info.email : "";
          name ||= typeof info.name === "string" ? info.name : "";
          emailVerified ||= info["email_verified"] === true;
          if (groups.length === 0) groups = readGroups(info[groupsClaim]);
        } catch (error) {
          logger.debug("OIDC userinfo unavailable", { error: String(error) });
        }
      }

      if (!email) {
        // Mica names people by email — it is who the commits are from. An
        // identity without one cannot be shown to anybody, so it is refused
        // rather than displayed as blank.
        throw new ApiError(
          "unauthenticated",
          "The identity provider did not release an email address. " +
            "Grant Mica the `email` scope.",
        );
      }

      return {
        issuer: String(claims.iss),
        subject: String(claims.sub),
        email,
        emailVerified,
        name: name || email,
        groups,
      };
    },

    /**
     * Where to send the browser to end the provider's session too.
     *
     * Null when the provider does not advertise the endpoint: signing out of
     * Mica always works, and signing out of the IdP is a bonus that not every
     * deployment can offer.
     */
    async endSessionUrl(): Promise<string | null> {
      try {
        const as = await configuration();
        return client
          .buildEndSessionUrl(as, {
            post_logout_redirect_uri: new URL("/admin/", config.MICA_PUBLIC_URL).toString(),
          })
          .toString();
      } catch {
        return null;
      }
    },
  };
}

export type OidcService = ReturnType<typeof createOidcService>;

/**
 * A groups claim, from a provider that may not send one and is under no
 * obligation to send it as an array.
 *
 * Keycloak sends a list of paths, Entra a list of ids, some deployments a
 * single string, and a misconfigured mapper sends an object. Everything that
 * is not a string in a list is dropped rather than coerced, because a group
 * name Mica invented would be a group name that could match a rule.
 */
function readGroups(value: unknown): string[] {
  if (typeof value === "string") return value.split(/[,\s]+/).filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** A random return path token, for the local mode that has no provider. */
export const randomToken = (): string => randomBytes(32).toString("base64url");
