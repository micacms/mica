/**
 * OpenID Connect.
 *
 * Mica does not authenticate anybody. It asks a provider who you are, and
 * records the answer. Hashing, reset flows, MFA, passkeys and breach response
 * all belong to the identity provider, and none of them are Mica's to get
 * wrong.
 *
 * What is Mica's is the small part here: run the authorization code flow
 * correctly, map the resulting subject to a user, and let the membership table
 * decide what that user may do.
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

import type { Config } from "../config.js";
import { ApiError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";

/** Carries state, PKCE verifier and nonce across the redirect to the provider. */
export const TRANSACTION_COOKIE = "mica_oidc";

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
  name: string;
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
  config: Config;
  logger: Logger;
}

export function createOidcService(deps: OidcServiceDeps) {
  const { config, logger } = deps;

  const redirectUri = new URL("/api/auth/callback", config.CMS_BASE_URL).toString();

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
        new URL(config.OIDC_ISSUER!),
        config.OIDC_CLIENT_ID!,
        config.OIDC_CLIENT_SECRET,
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
          issuer: config.OIDC_ISSUER,
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
        scope: config.OIDC_SCOPE,
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

      // Not every provider puts email and name in the ID token; some keep them
      // at the userinfo endpoint. Ask only when something is missing.
      let email = typeof claims["email"] === "string" ? claims["email"] : "";
      let name = typeof claims["name"] === "string" ? claims["name"] : "";

      if (!email || !name) {
        try {
          const info = await client.fetchUserInfo(as, tokens.access_token, claims.sub);
          email ||= typeof info.email === "string" ? info.email : "";
          name ||= typeof info.name === "string" ? info.name : "";
        } catch (error) {
          logger.debug("OIDC userinfo unavailable", { error: String(error) });
        }
      }

      if (!email) {
        // Mica identifies people to each other by email — in the Users screen,
        // and as the author of every commit. An identity without one cannot be
        // shown to anybody, so it is refused rather than displayed as blank.
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
        name: name || email,
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
            post_logout_redirect_uri: new URL("/admin/", config.CMS_BASE_URL).toString(),
          })
          .toString();
      } catch {
        return null;
      }
    },
  };
}

export type OidcService = ReturnType<typeof createOidcService>;

/** A random return path token, for the local mode that has no provider. */
export const randomToken = (): string => randomBytes(32).toString("base64url");
