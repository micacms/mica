/**
 * Session state.
 *
 * A module-scoped ref rather than a store library: there is exactly one session
 * per tab, and nothing here needs devtools time-travel or plugins.
 *
 * Note what it is not. There is no account, no role and no profile, because
 * Mica stores none of those. `identity` is what the provider said at sign-in,
 * and it is null wherever there is no provider — which is what local mode
 * looks like from here: not an anonymous user, but no user at all.
 */

import { computed, ref } from "vue";

import { api, ApiError, type AuthConfig, type Identity } from "@/api";

const identity = ref<Identity | null>(null);
const active = ref(false);
const checked = ref(false);
const authConfig = ref<AuthConfig | null>(null);
/** When the session ends, as the server last said. Null without sign-in. */
const expiresAt = ref<string | null>(null);
/** The session ended while the editor was working: the page stays, and offers to sign in again. */
const ended = ref(false);
/** A sign-in redirect is under way: the forms have kept their changes, so leaving is safe. */
const leaving = ref(false);

export function useSession() {
  return {
    /** Who this is, where anybody asked. Null in local mode. */
    identity: computed(() => identity.value),
    /** Whether the editor may be used at all. */
    isActive: computed(() => active.value),
    /** False until the first `/auth/me` has resolved, so guards can wait. */
    checked: computed(() => checked.value),
    /** How this deployment authenticates. Null until `restore` has run. */
    config: computed(() => authConfig.value),
    /** True only where there is a provider, and therefore something to show. */
    showsIdentity: computed(() => authConfig.value?.authRequired === true),
    expiresAt: computed(() => expiresAt.value),
    ended: computed(() => ended.value),
    leaving: computed(() => leaving.value),

    /** Restores the session on a page load. Never throws. */
    async restore(): Promise<void> {
      try {
        // The config decides everything else. Where this deployment does not
        // authenticate — the local editor — there is no session to restore,
        // no /me to ask, and nobody to be: the editor simply opens.
        const config = await api.auth.config();
        authConfig.value = config;

        if (!config.authRequired) {
          identity.value = null;
          active.value = true;
          return;
        }

        const session = await api.auth.me();
        identity.value = session.identity;
        expiresAt.value = session.expiresAt;
        active.value = true;
        ended.value = false;
      } catch (error) {
        if (!(error instanceof ApiError) || !error.isUnauthenticated) {
          console.error("Failed to restore session", error);
        }
        identity.value = null;
        active.value = false;
      } finally {
        checked.value = true;
      }
    },

    /**
     * Leaves the SPA.
     *
     * Sign-in is a redirect to another origin, so there is nothing to await and
     * nothing to return — the browser comes back to `returnTo` with a session
     * cookie already set, and `restore` picks it up on the next page load.
     */
    signIn(returnTo = "/admin/"): void {
      leaving.value = true;
      window.location.href = api.auth.signInUrl(returnTo);
    },

    /** Asks the server again, which also extends an idle session. False when it has ended. */
    async extend(): Promise<boolean> {
      try {
        expiresAt.value = (await api.auth.me()).expiresAt;
        return true;
      } catch {
        return false;
      }
    },

    /** The end of the session, as the last response named it. */
    noteExpiry(at: string): void {
      expiresAt.value = at;
    },

    /** A request came back 401 during work: keep the page, and say so. */
    markEnded(): void {
      if (active.value && authConfig.value?.authRequired) ended.value = true;
    },

    async signOut(): Promise<void> {
      let endSession: string | null = null;
      try {
        ({ endSession } = await api.auth.logout());
      } finally {
        identity.value = null;
        active.value = false;
      }

      // Mica's session is gone either way. If the provider offers to end its
      // own, follow it — otherwise the next sign-in would be silent and look
      // like the sign-out never happened.
      if (endSession) window.location.href = endSession;
    },

  };
}
