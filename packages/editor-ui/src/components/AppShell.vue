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

import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
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

import { announcement } from "@/lib/announce";
import { useSchema } from "@/stores/schema";
import { useSession } from "@/stores/session";
import { useStaging } from "@/stores/staging";

const route = useRoute();
const router = useRouter();
const session = useSession();
const staging = useStaging();
const { collections, singletons, schema } = useSchema();

function reloadPage(): void {
  // The unsaved-changes guard asks first when a form has edits.
  window.location.reload();
}

/** The server uses a newer content model than this page shows. */
const modelChanged = computed(() => {
  const serving = staging.status.value?.model;
  return serving !== undefined && schema.value !== null && serving.revision !== schema.value.revision;
});

/**
 * Minutes until the session ends, when that is soon. Each response names the
 * end, so the check asks nobody: asking would extend an idle session, and the
 * idle limit must still end a session in an unattended tab.
 */
const endsInMinutes = ref<number | null>(null);
const WARN_MS = 5 * 60_000;

function checkExpiry(): void {
  const at = session.expiresAt.value;
  const left = at && !session.ended.value ? Date.parse(at) - Date.now() : null;
  endsInMinutes.value = left !== null && left > 0 && left < WARN_MS ? Math.max(1, Math.round(left / 60_000)) : null;
}

const expiryTimer = window.setInterval(checkExpiry, 30_000);
onUnmounted(() => window.clearInterval(expiryTimer));

async function stayIn(): Promise<void> {
  await session.extend();
  checkExpiry();
}

function signInAgain(): void {
  session.signIn(`/admin${route.fullPath}`);
}

const menuOpen = ref(false);
const drawer = ref<HTMLElement | null>(null);
const menuButton = ref<HTMLButtonElement | null>(null);

// Below this width the sidebar is a drawer; closed, it must leave the tab order.
const wide = window.matchMedia("(min-width: 1024px)");
const isWide = ref(wide.matches);
const onWidth = (event: MediaQueryListEvent) => (isWide.value = event.matches);
wide.addEventListener("change", onWidth);
onUnmounted(() => wide.removeEventListener("change", onWidth));

const drawerHidden = computed(() => !isWide.value && !menuOpen.value);

watch(menuOpen, async (open) => {
  if (isWide.value) return;
  await nextTick();
  if (open) drawer.value?.querySelector<HTMLElement>("a, button")?.focus();
  else if (drawer.value?.contains(document.activeElement)) menuButton.value?.focus();
});

function skipToContent(): void {
  document.getElementById("main")?.focus();
}

function onDrawerKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && menuOpen.value) {
    menuOpen.value = false;
    menuButton.value?.focus();
  }
}

// On a phone the sidebar is an overlay; navigating must dismiss it.
watch(
  () => route.fullPath,
  () => {
    menuOpen.value = false;
  },
);

// The badge refreshes when a view saves, discards or publishes, and when the editor
// comes back to the window, where a colleague's work may have changed it (#76).
const refreshOnFocus = () => void staging.refresh();
onMounted(() => {
  void staging.refresh();
  window.addEventListener("focus", refreshOnFocus);
});
onUnmounted(() => window.removeEventListener("focus", refreshOnFocus));

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
  <!-- Moves the focus in code: a "#main" in the address would load the page again. -->
  <a href="#main" class="skip-link" @click.prevent="skipToContent">Skip to the content</a>
  <p class="sr-only" aria-live="polite" aria-atomic="true">{{ announcement }}</p>

  <div class="flex min-h-full">
    <!-- Backdrop for the mobile overlay -->
    <div
      v-if="menuOpen"
      class="fixed inset-0 z-20 bg-ink/25 lg:hidden"
      aria-hidden="true"
      @click="menuOpen = false"
    />

    <aside
      id="main-navigation"
      ref="drawer"
      :inert="drawerHidden"
      :class="[
        'fixed inset-y-0 left-0 z-30 flex w-[220px] shrink-0 flex-col border-r border-creme/10 bg-aubergine text-creme transition-transform lg:static lg:translate-x-0',
        menuOpen ? 'translate-x-0' : '-translate-x-full',
      ]"
      @keydown="onDrawerKeydown"
    >
      <div class="flex h-14 items-center border-b border-creme/10 px-3">
        <img src="/brand/micacms-wordmark-light.svg" alt="micacms" class="h-5 w-auto" />
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
              class="rounded-full bg-creme px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-aubergine"
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
      <div v-if="session.showsIdentity.value" class="border-t border-creme/10 p-2">
        <div class="flex items-center gap-2.5 rounded-md px-2 py-2">
          <span
            class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-creme text-[10px] font-semibold text-aubergine"
            aria-hidden="true"
          >
            {{ initials }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-xs font-medium text-creme/80">
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
        class="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur lg:hidden"
      >
        <button
          ref="menuButton"
          type="button"
          class="btn-ghost -ml-1 px-2"
          :aria-expanded="menuOpen"
          aria-controls="main-navigation"
          @click="menuOpen = !menuOpen"
        >
          <Menu :size="20" aria-hidden="true" />
          <span class="sr-only">Toggle navigation</span>
        </button>
        <img src="/brand/micacms-wordmark.svg" alt="micacms" class="h-5 w-auto" />
      </header>

      <main id="main" tabindex="-1" class="min-w-0 flex-1 bg-surface focus:outline-none">
        <div v-if="session.ended.value" role="alert" class="flex flex-wrap items-center gap-3 border-b border-line bg-danger-soft px-4 py-2.5 text-sm sm:px-6">
          <span class="min-w-0 flex-1">
            Your session ended, so Mica cannot save. Your changes stay in this tab: sign in again, and you can restore them.
          </span>
          <button type="button" class="btn-primary" @click="signInAgain">Sign in again</button>
        </div>
        <div v-else-if="endsInMinutes !== null" role="status" class="flex flex-wrap items-center gap-3 border-b border-line bg-warning-soft px-4 py-2.5 text-sm sm:px-6">
          <span class="min-w-0 flex-1">
            Your session ends in {{ endsInMinutes }} minute{{ endsInMinutes === 1 ? "" : "s" }}. Save your work.
          </span>
          <button type="button" class="btn-secondary" @click="stayIn">Stay signed in</button>
        </div>
        <div v-if="modelChanged" role="status" class="flex flex-wrap items-center gap-3 border-b border-line bg-warning-soft px-4 py-2.5 text-sm sm:px-6">
          <span class="min-w-0 flex-1">The content model changed: there are new or changed fields. Save your work, then load the page again.</span>
          <button type="button" class="btn-secondary" @click="reloadPage">Load again</button>
        </div>
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
@reference "../style.css";

.skip-link {
  @apply sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md
    focus:bg-raised focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:shadow-lg;
}

.nav-heading {
  @apply px-2 pb-1.5 font-mono text-[10px] font-medium uppercase tracking-[.08em] text-creme/60;
}

.nav-link {
  @apply flex h-9 items-center gap-2.5 rounded-md px-2 text-[13px] text-creme/70
    transition hover:bg-creme/5 hover:text-creme/90;
  transition-duration: var(--mica-duration-fast);
  transition-timing-function: var(--mica-ease-standard);
}

.nav-link.router-link-active {
  @apply bg-creme/12 text-creme;
}

.sidebar-signout {
  @apply flex items-center justify-start gap-2.5 rounded-md px-2 py-1.5 text-xs text-creme/65 transition
    hover:bg-creme/5 hover:text-creme/90 disabled:opacity-40;
}
</style>
