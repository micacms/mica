/**
 * Admission — who may edit this site.
 *
 * OpenID Connect states who a person is. It says nothing about whether that
 * person may edit this website: a provider vouches for a whole company, and a
 * perfectly valid ID token is the beginning of the question rather than the
 * answer to it.
 *
 * Mica used to answer it from a `memberships` table. It no longer has one, and
 * has no accounts to put in it. Admission is configuration:
 *
 *   MICA_ADMIT_GROUP=mica-editors            a claim the provider sends
 *   MICA_ADMIT_DOMAIN=example.com            every verified address there
 *   MICA_ADMIT_SUBJECTS=https://id.example.com|a1b2c3
 *
 * The group rule is the one to grow into. Adding an editor is then a group
 * change in the identity provider — where the operator already manages
 * joiners and leavers — and Mica is not touched, not restarted, and holds no
 * copy of the list to go stale. The subject list exists for a provider with no
 * groups, and for the first sign-in before a group exists.
 *
 * What this costs, and it is a real cost: removing somebody from a group at
 * the provider does not take effect until their next sign-in, because the
 * claims Mica checks are the ones it was given. Configuration changes *are*
 * immediate — this policy is re-read on every request — and the session
 * lifetime is the upper bound on the rest. That trade is recorded as a P1
 * decision in docs/decisions.md.
 */

import type { AuthConfig } from "./config.js";
import type { SessionIdentity } from "./sessions-repository.js";

export type AdmissionResult = { admitted: true } | { admitted: false; reason: string };

export interface AdmissionPolicy {
  /** One line for the startup log, so an operator can see what is in force. */
  readonly summary: string;
  admits(identity: SessionIdentity): AdmissionResult;
}

/**
 * The subject is the account key, and an email address is never one.
 *
 * Most providers let a person change their address, and some let two people
 * hold one in turn. Keying admission on an address is therefore a standing
 * offer to whoever holds it next, which is a well-trodden route to account
 * takeover. The issuer is part of the key because a subject is only unique
 * within the provider that issued it.
 */
function matchesSubject(
  identity: SessionIdentity,
  entries: ReadonlyArray<{ issuer: string; subject: string }>,
): boolean {
  return entries.some(
    (entry) => entry.issuer === identity.issuer && entry.subject === identity.subject,
  );
}

function matchesDomain(identity: SessionIdentity, domains: readonly string[]): boolean {
  const at = identity.email.lastIndexOf("@");
  if (at < 0) return false;
  return domains.includes(identity.email.slice(at + 1).toLowerCase());
}

/**
 * Group names are compared case-sensitively, and a leading `/` is ignored.
 *
 * Keycloak sends group paths — `/mica-editors` — while most other providers
 * send bare names. Accepting both means an operator writes the name they see
 * in their own console, which is the only name they have.
 */
function matchesGroup(identity: SessionIdentity, groups: readonly string[]): boolean {
  const held = new Set(identity.groups.map((group) => group.replace(/^\//, "")));
  return groups.some((group) => held.has(group.replace(/^\//, "")));
}

export function createAdmissionPolicy(
  config: Pick<AuthConfig, "admitGroups" | "admitDomains" | "admitSubjects">,
): AdmissionPolicy {
  const { admitGroups, admitDomains, admitSubjects } = config;

  const summary = [
    admitGroups.length > 0 ? `group=${admitGroups.join("|")}` : null,
    admitDomains.length > 0 ? `domain=${admitDomains.join("|")}` : null,
    admitSubjects.length > 0 ? `subjects=${admitSubjects.length}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return {
    summary,

    admits(identity) {
      // The explicit list first: it is the escape hatch, and it has to work
      // when the group claim is missing or the address is unverified.
      if (matchesSubject(identity, admitSubjects)) return { admitted: true };

      if (matchesGroup(identity, admitGroups)) return { admitted: true };

      if (admitDomains.length > 0 && matchesDomain(identity, admitDomains)) {
        /**
         * A domain rule trusts the provider to have checked the address.
         *
         * Where a provider allows self-registration, an unverified address is
         * a claim the person typed. Admitting on that would let anybody enter
         * a domain they do not hold, so the rule refuses and says why — the
         * operator can turn verification on, or use a group or subject rule
         * instead.
         */
        if (identity.emailVerified) return { admitted: true };

        return {
          admitted: false,
          reason:
            `${identity.email} is in an admitted domain, but the identity provider ` +
            "does not report the address as verified.",
        };
      }

      return {
        admitted: false,
        reason: `${identity.email || identity.subject} is not admitted to this site.`,
      };
    },
  };
}
