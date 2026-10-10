<script setup lang="ts">
/**
 * Navigation frame.
 *
 * The sidebar is generated from the content model: collections first, then
 * media, then singletons, then the system page. Nothing here is hard-coded per
 * customer.
 *
 * The identity block at the foot is the one part that is not the editor. It
 * appears only where a provider said who somebody is, which means it is absent
 * on a developer's own machine — no name, no avatar, no sign-out, and no empty
 * space reserved for them. It belongs to the self-hosted shell rather than to
 * the editor, and moves there when the packages split.
 */

import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  Files,
  Image as ImageIcon,
  LayoutDashboard,
  LogOut,
  Menu,
  Send,
  Settings,
  SlidersHorizontal,
} from "@lucide/vue";

import { useSchema } from "@/stores/schema";
import { useSession } from "@/stores/session";
import { useStaging } from "@/stores/staging";

const route = useRoute();
const router = useRouter();
const session = useSession();
const staging = useStaging();
const { collections, singletons } = useSchema();

const menuOpen = ref(false);

// On a phone the sidebar is an overlay; navigating must dismiss it. The badge
// refreshes on the same signal: navigation is when an editor looks at the
// sidebar again, and one small request per page keeps it honest enough.
watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false;
    void staging.refresh();
  },
);

onMounted(() => void staging.refresh());

const initials = computed(() => {
  const source = session.identity.value?.name || session.identity.value?.email || "";
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
  await session.signOut();
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
      id="main-navigation"
      :class="[
        'fixed inset-y-0 left-0 z-30 flex w-[220px] shrink-0 flex-col border-r border-white/10 bg-[#111110] text-white transition-transform lg:static lg:translate-x-0',
        menuOpen ? 'translate-x-0' : '-translate-x-full',
      ]"
    >
      <div class="flex h-14 items-center border-b border-white/10 px-3">
        <img src="/brand/mica-logo-glimmer-light.svg" alt="Mica" class="h-7 w-auto" />
      </div>

      <nav class="flex-1 space-y-5 overflow-y-auto px-2 py-3" aria-label="Main">
        <div>
          <RouterLink :to="{ name: 'dashboard' }" class="nav-link">
            <LayoutDashboard :size="14" aria-hidden="true" />
            Overview
          </RouterLink>
          <RouterLink :to="{ name: 'changes' }" class="nav-link">
            <Send :size="14" aria-hidden="true" />
            <span class="flex-1">Publish</span>
            <span
              v-if="staging.editCount.value > 0"
              class="rounded-full bg-accent px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-white"
              :aria-label="`${staging.editCount.value} pending edit${staging.editCount.value === 1 ? '' : 's'}`"
            >
              {{ staging.editCount.value }}
            </span>
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
            <Files :size="14" aria-hidden="true" />
            {{ collection.label }}
          </RouterLink>
          <RouterLink :to="{ name: 'media' }" class="nav-link">
            <ImageIcon :size="14" aria-hidden="true" />
            Media
          </RouterLink>
        </div>

        <div v-if="singletons.length">
          <p class="nav-heading">Settings</p>
          <RouterLink
            v-for="singleton in singletons"
            :key="singleton.name"
            :to="{ name: 'singleton', params: { name: singleton.name } }"
            class="nav-link"
          >
            <SlidersHorizontal :size="14" aria-hidden="true" />
            {{ singleton.label }}
          </RouterLink>
        </div>

        <div>
          <p class="nav-heading">Deployment</p>
          <RouterLink :to="{ name: 'system' }" class="nav-link">
            <Settings :size="14" aria-hidden="true" />
            System
          </RouterLink>
        </div>
      </nav>

      <!-- Absent entirely where there is no provider: see the note above. -->
      <div v-if="session.showsIdentity.value" class="border-t border-white/10 p-2">
        <div class="flex items-center gap-2.5 rounded-md px-2 py-2">
          <span
            class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-[10px] font-semibold text-white"
            aria-hidden="true"
          >
            {{ initials }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-xs font-medium text-white/80">
              {{ session.identity.value?.name || session.identity.value?.email }}
            </span>
          </span>
        </div>

        <button type="button" class="sidebar-signout mt-1 w-full" @click="signOut">
          <LogOut :size="14" aria-hidden="true" />
          Sign out
        </button>
      </div>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header
        class="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur lg:hidden"
      >
        <button
          type="button"
          class="btn-ghost -ml-1 px-2"
          :aria-expanded="menuOpen"
          aria-controls="main-navigation"
          @click="menuOpen = !menuOpen"
        >
          <Menu :size="20" aria-hidden="true" />
          <span class="sr-only">Toggle navigation</span>
        </button>
        <img src="/brand/mica-logo-glimmer.svg" alt="Mica" class="h-7 w-auto" />
      </header>

      <main class="min-w-0 flex-1 bg-surface">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
@reference "../style.css";

.nav-heading {
  @apply px-2 pb-1.5 font-mono text-[10px] font-medium uppercase tracking-[.08em] text-white/35;
}

.nav-link {
  @apply flex h-9 items-center gap-2.5 rounded-md px-2 text-[13px] text-white/55
    transition hover:bg-white/5 hover:text-white/80;
  transition-duration: var(--mica-duration-fast);
  transition-timing-function: var(--mica-ease-standard);
}

.nav-link.router-link-active {
  background: rgb(107 92 166 / 20%);
  color: var(--mica-glimmer-400);
}

.sidebar-signout {
  @apply flex items-center justify-start gap-2.5 rounded-md px-2 py-1.5 text-xs text-white/40 transition
    hover:bg-white/5 hover:text-white/70 disabled:opacity-40;
}
</style>
