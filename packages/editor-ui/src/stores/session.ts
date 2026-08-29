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
        active.value = true;
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
      window.location.href = api.auth.signInUrl(returnTo);
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

    /** Called when any request comes back 401, so the UI drops to sign-in. */
    clear(): void {
      identity.value = null;
      active.value = false;
      checked.value = true;
    },
  };
}
