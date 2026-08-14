/**
 * Session state.
 *
 * A module-scoped ref rather than a store library: there is exactly one signed-
 * in user per tab, and nothing here needs devtools time-travel or plugins.
 */

import { computed, ref } from "vue";

import { api, ApiError, type AdminUser, type AuthConfig } from "@/api";

const user = ref<AdminUser | null>(null);
const checked = ref(false);
const authConfig = ref<AuthConfig | null>(null);

export function useAuth() {
  return {
    user: computed(() => user.value),
    isAuthenticated: computed(() => user.value !== null),
    isAdmin: computed(() => user.value?.role === "admin"),
    /** False until the first `/auth/me` has resolved, so guards can wait. */
    checked: computed(() => checked.value),
    /** How this deployment authenticates. Null until `restore` has run. */
    config: computed(() => authConfig.value),

    /** Restores the session on a page load. Never throws. */
    async restore(): Promise<void> {
      // Both at once: the sign-in screen needs the config even when — in fact
      // especially when — there is no session to restore.
      const [session, config] = await Promise.allSettled([api.auth.me(), api.auth.config()]);

      if (session.status === "fulfilled") {
        user.value = session.value.user;
      } else {
        const error = session.reason;
        if (!(error instanceof ApiError) || !error.isUnauthenticated) {
          console.error("Failed to restore session", error);
        }
        user.value = null;
      }

      if (config.status === "fulfilled") authConfig.value = config.value;
      checked.value = true;
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
        user.value = null;
      }

      // Mica's session is gone either way. If the provider offers to end its
      // own, follow it — otherwise the next sign-in would be silent and look
      // like the sign-out never happened.
      if (endSession) window.location.href = endSession;
    },

    /** Called when any request comes back 401, so the UI drops to sign-in. */
    clear(): void {
      user.value = null;
      checked.value = true;
    },

    setUser(next: AdminUser): void {
      user.value = next;
    },
  };
}
