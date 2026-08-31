/**
 * Who a request acts as — the auth-neutral answer.
 *
 * The runtime consumes this and nothing more. How it was produced is the
 * composing app's business: the self-hosted app fills it from an OIDC session,
 * the local editor sets `identity: null` because on a developer's own machine
 * there is no provider, no account and nobody to be. That null is not an
 * anonymous user; it is the absence of the concept.
 *
 * There is deliberately no capability set. An admitted person has every
 * editor capability on this site, and a `can()` that always answers yes
 * would be structure standing in for a decision nobody has made.
 */

export interface AccessIdentity {
  /** The provider's subject: stable, opaque, never an email. */
  subject: string;
  email: string;
  name: string;
}

export interface AccessContext {
  identity: AccessIdentity | null;
}
