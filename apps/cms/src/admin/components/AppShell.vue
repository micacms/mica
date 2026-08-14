<script setup lang="ts">
/**
 * Navigation frame.
 *
 * The sidebar is generated from the content model (§10): collections first,
 * then media, then singletons, then administration. Nothing here is hard-coded
 * per customer.
 */

import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { useAuth } from "@/stores/auth";
import { useSchema } from "@/stores/schema";

const route = useRoute();
const router = useRouter();
const auth = useAuth();
const { collections, singletons } = useSchema();

const menuOpen = ref(false);

// On a phone the sidebar is an overlay; navigating must dismiss it.
watch(() => route.fullPath, () => (menuOpen.value = false));

const initials = computed(() => {
  const source = auth.user.value?.name || auth.user.value?.email || "";
  return (
    source
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
});

async function signOut(): Promise<void> {
  await auth.signOut();
  await router.push({ name: "login" });
}
</script>

<template>
  <div class="flex min-h-full">
    <!-- Backdrop for the mobile overlay -->
    <div
      v-if="menuOpen"
      class="fixed inset-0 z-20 bg-black/25 lg:hidden"
      aria-hidden="true"
      @click="menuOpen = false"
    />

    <aside
      :class="[
        'fixed inset-y-0 left-0 z-30 flex w-64 shrink-0 flex-col border-r border-line bg-surface transition-transform lg:static lg:translate-x-0',
        menuOpen ? 'translate-x-0' : '-translate-x-full',
      ]"
    >
      <div class="flex h-14 items-center gap-2.5 border-b border-line px-5">
        <svg viewBox="0 0 32 32" class="h-7 w-7" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="var(--color-brand)" />
          <path
            d="M8 22V10l8 7 8-7v12"
            stroke="#fff"
            stroke-width="2.5"
            fill="none"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        </svg>
        <span class="text-[15px] font-semibold tracking-tight">Mica</span>
      </div>

      <nav class="flex-1 space-y-6 overflow-y-auto px-3 py-5" aria-label="Main">
        <div>
          <RouterLink :to="{ name: 'dashboard' }" class="nav-link">
            <span class="nav-dot" aria-hidden="true" />
            Overview
          </RouterLink>
        </div>

        <div v-if="collections.length">
          <p class="nav-heading">Content</p>
          <RouterLink
            v-for="collection in collections"
            :key="collection.name"
            :to="{ name: 'collection', params: { collection: collection.name } }"
            class="nav-link"
          >
            {{ collection.label }}
          </RouterLink>
          <RouterLink :to="{ name: 'media' }" class="nav-link">Media</RouterLink>
        </div>

        <div v-if="singletons.length">
          <p class="nav-heading">Settings</p>
          <RouterLink
            v-for="singleton in singletons"
            :key="singleton.name"
            :to="{ name: 'singleton', params: { name: singleton.name } }"
            class="nav-link"
          >
            {{ singleton.label }}
          </RouterLink>
        </div>

        <div>
          <p class="nav-heading">Administration</p>
          <RouterLink v-if="auth.isAdmin.value" :to="{ name: 'users' }" class="nav-link">
            People
          </RouterLink>
          <!-- Editors see it too: version and content model answer their
               questions as often as an administrator's. -->
          <RouterLink :to="{ name: 'system' }" class="nav-link">System</RouterLink>
        </div>
      </nav>

      <div class="border-t border-line p-3">
        <RouterLink
          :to="{ name: 'account' }"
          class="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-canvas"
        >
          <span
            class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand"
            aria-hidden="true"
          >
            {{ initials }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium">
              {{ auth.user.value?.name || auth.user.value?.email }}
            </span>
            <span class="block text-xs text-muted">
              {{ auth.user.value?.role === "admin" ? "Administrator" : "Editor" }}
            </span>
          </span>
        </RouterLink>

        <button type="button" class="btn-ghost mt-1 w-full justify-start" @click="signOut">
          Sign out
        </button>
      </div>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header
        class="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur lg:hidden"
      >
        <button
          type="button"
          class="btn-ghost -ml-1 px-2"
          :aria-expanded="menuOpen"
          aria-controls="main-navigation"
          @click="menuOpen = !menuOpen"
        >
          <svg viewBox="0 0 20 20" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.75">
            <path d="M3 5h14M3 10h14M3 15h14" stroke-linecap="round" />
          </svg>
          <span class="sr-only">Toggle navigation</span>
        </button>
        <span class="text-sm font-semibold">Mica</span>
      </header>

      <main class="min-w-0 flex-1">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
@reference "../style.css";

.nav-heading {
  @apply px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted;
}

.nav-link {
  @apply flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-ink
    transition hover:bg-canvas;
}

.nav-link.router-link-active {
  @apply bg-brand-soft font-medium text-brand;
}

.nav-dot {
  @apply h-1.5 w-1.5 rounded-full bg-current opacity-40;
}
</style>
