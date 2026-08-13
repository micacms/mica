/**
 * Session state.
 *
 * A module-scoped ref rather than a store library: there is exactly one signed-
 * in user per tab, and nothing here needs devtools time-travel or plugins.
 */

import { computed, ref } from "vue";

import { api, ApiError, type AdminUser } from "@/api";

const user = ref<AdminUser | null>(null);
const checked = ref(false);

export function useAuth() {
  return {
    user: computed(() => user.value),
    isAuthenticated: computed(() => user.value !== null),
    isAdmin: computed(() => user.value?.role === "admin"),
    /** False until the first `/auth/me` has resolved, so guards can wait. */
    checked: computed(() => checked.value),

    /** Restores the session on a page load. Never throws. */
    async restore(): Promise<void> {
      try {
        const { user: current } = await api.auth.me();
        user.value = current;
      } catch (error) {
        if (!(error instanceof ApiError) || !error.isUnauthenticated) {
          console.error("Failed to restore session", error);
        }
        user.value = null;
      } finally {
        checked.value = true;
      }
    },

    async signIn(email: string, password: string): Promise<AdminUser> {
      const { user: current } = await api.auth.login(email, password);
      user.value = current;
      checked.value = true;
      return current;
    },

    async signOut(): Promise<void> {
      try {
        await api.auth.logout();
      } finally {
        user.value = null;
      }
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
