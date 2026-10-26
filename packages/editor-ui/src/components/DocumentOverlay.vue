<script setup lang="ts">
/**
 * The overlay form: a document without a page of its own that the preview's
 * page shows, such as the navigation, over the main form; the preview stays
 * beside it. The address names it (`?overlay=navigation`, `?overlay=team/anna`),
 * so that a reload opens it again.
 * It slides in from the left and leaves a narrow edge of the main form, which
 * stays open below it with its unsaved changes. One overlay at a time: a click
 * on a field of a third document replaces it, and asks first when it has
 * unsaved changes.
 */

import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ChevronLeft } from "@lucide/vue";

import { usePreviewPane } from "@/composables/usePreviewPane";
import { withoutOverlay } from "@/lib/overlay-address";
import { focusField } from "@/lib/focus";
import { useSchema } from "@/stores/schema";

// Loaded when needed, as the router loads them.
const EntryView = defineAsyncComponent(() => import("@/views/EntryView.vue"));
const SingletonView = defineAsyncComponent(() => import("@/views/SingletonView.vue"));

const pane = usePreviewPane();
const route = useRoute();
const router = useRouter();
const schema = useSchema();

const target = pane.overlay;
const view = ref<{ atRisk: () => boolean } | null>(null);
const panel = ref<HTMLElement | null>(null);

pane.guardOverlay(() => !!view.value?.atRisk());

/** What the overlay edits, for screen readers: "Navigation", "Team member". */
const documentLabel = computed(() => {
  const value = target.value;
  if (!value) return "";
  return value.kind === "entry"
    ? (schema.collection(value.document)?.labelSingular ?? value.document)
    : (schema.singleton(value.document)?.label ?? value.document);
});

/**
 * The duration of the slide in milliseconds: the brand's slow token, which the
 * build can write in seconds (".35s"). The panel's transform does not tell Vue
 * when it ends, because the transition is on a child.
 */
function slowDuration(): number {
  const token = getComputedStyle(document.documentElement).getPropertyValue("--mica-duration-slow").trim();
  const value = Number.parseFloat(token);
  if (Number.isNaN(value)) return 350;
  return token.endsWith("ms") ? value : value * 1000;
}
const duration = slowDuration();

/** A new key for each document: a third document slides the overlay out, and its own one in. */
const documentKey = computed(() => (target.value ? `${target.value.kind}:${target.value.document}/${target.value.id}` : ""));

/**
 * The title of the main form, for the back link: "‹ Haus A". Read from its
 * heading when the overlay opens; the main form takes no input meanwhile.
 */
const mainTitle = ref("");
/** Always says where it goes: "Back to page Haus A". */
const backLabel = computed(() => (mainTitle.value ? `Back to page ${mainTitle.value}` : "Back to the page"));
watch(
  () => !!target.value,
  (open) => {
    if (open) mainTitle.value = document.querySelector("#main h1")?.textContent?.trim() ?? "";
  },
  { immediate: true },
);

/** The overlay in the address: `navigation` for settings, `team/anna` for an entry. */
const addressOf = (value: typeof target.value): string | undefined =>
  value ? (value.kind === "entry" ? `${value.document}/${value.id}` : value.document) : undefined;

/**
 * An overlay that opens goes into the address. One that closes goes out of it
 * where it closes without a navigation (`close`); a navigation to another form
 * has an address without it.
 */
watch(target, (value) => {
  const wanted = addressOf(value);
  if (!wanted || route.query["overlay"] === wanted) return;
  void router.replace({ query: { ...route.query, overlay: wanted } });
});

// A reload, or the browser's Back and Forward: the address says which overlay is open.
watch(
  () => route.query["overlay"],
  (value) => {
    if (typeof value !== "string" || value === "") {
      if (target.value && !pane.closeOverlay()) void router.replace({ query: { ...route.query, overlay: addressOf(target.value) } });
      return;
    }
    if (value === addressOf(target.value)) return;
    const [document, id] = value.split("/");
    if (id !== undefined && schema.collection(document!)) pane.openOverlay({ kind: "entry", document: document!, id, field: "" });
    else if (id === undefined && schema.singleton(document!)) pane.openOverlay({ kind: "singleton", document: document!, id: document!, field: "" });
  },
  { immediate: true },
);

// A second click on a field of the document that is open here: go to that field.
// Another document gets a new panel, whose form goes to the field when it opens.
watch(target, async (next, before) => {
  if (!next || !before || next.request === before.request) return;
  if (next.kind !== before.kind || next.document !== before.document || next.id !== before.id) return;
  await nextTick();
  if (panel.value) focusField(next.field, panel.value);
});

function close(): void {
  if (!pane.closeOverlay()) return;
  document.getElementById("main")?.focus({ preventScroll: true });
  void router.replace({ query: withoutOverlay(route.query) });
}

/** Its entry is gone, by a discard of a new entry, or it could not be loaded. */
function dropped(): void {
  pane.dropOverlay();
  void router.replace({ query: withoutOverlay(route.query) });
}

function renamed(id: string): void {
  if (target.value) pane.openOverlay({ ...target.value, id });
}

// The main form changes: the overlay belongs to the page that it was opened on.
const removeGuard = router.beforeEach((to, from) => {
  if (!target.value || to.path === from.path) return true;
  if (view.value?.atRisk() && !pane.closeOverlay()) return false;
  pane.dropOverlay();
  return true;
});
onBeforeUnmount(removeGuard);

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  event.preventDefault();
  close();
}
</script>

<template>
  <!-- Over the main form only, which stays below with its state and its scroll position. The preview stays beside it. -->
  <Transition name="overlay" mode="out-in" :duration="duration">
    <div v-if="target" :key="documentKey" class="absolute inset-0 z-20">
      <div class="overlay-scrim absolute inset-0 cursor-pointer bg-scrim/40" aria-hidden="true" @click="close" />
      <section
        ref="panel"
        data-document-form
        :aria-label="`Edit ${documentLabel}`"
        class="overlay-panel sticky top-2 mt-2 mr-2 flex h-[calc(100vh-1rem)] flex-col overflow-clip rounded-r-xl border border-l-0 border-line bg-ground shadow-xl"
        @keydown="onKeydown"
      >
        <div class="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
          <button
            type="button"
            class="inline-flex min-w-0 cursor-pointer items-center gap-1 text-xs font-medium text-muted hover:text-ink"
            :title="`${backLabel} (Esc)`"
            @click="close"
          >
            <ChevronLeft :size="14" aria-hidden="true" class="shrink-0" />
            <span class="truncate">{{ backLabel }}</span>
          </button>
        </div>

        <!-- Only this part scrolls; `overflow-clip` above cannot, so the back link stays in place. -->
        <div class="min-h-0 flex-1 scroll-pt-28 overflow-y-auto">
          <EntryView
            v-if="target.kind === 'entry'"
            ref="view"
            embedded
            :collection="target.document"
            :id="target.id"
            :focus="target.field"
            @renamed="renamed"
            @close="dropped"
          />
          <SingletonView v-else ref="view" embedded :name="target.document" :focus="target.field" />
        </div>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
/* The panel slides from the left edge, where the sidebar is, and goes back there; the dimmed form below fades. */
.overlay-enter-active .overlay-scrim,
.overlay-leave-active .overlay-scrim {
  transition: opacity var(--mica-duration-slow) var(--mica-ease-standard);
}

.overlay-enter-active .overlay-panel {
  transition: transform var(--mica-duration-slow) var(--mica-ease-decelerate);
}

.overlay-leave-active .overlay-panel {
  transition: transform var(--mica-duration-slow) var(--mica-ease-accelerate);
}

.overlay-enter-from .overlay-scrim,
.overlay-leave-to .overlay-scrim {
  opacity: 0;
}

.overlay-enter-from .overlay-panel,
.overlay-leave-to .overlay-panel {
  transform: translateX(-100%);
}

@media (prefers-reduced-motion: reduce) {
  .overlay-enter-from .overlay-panel,
  .overlay-leave-to .overlay-panel {
    transform: none;
  }
}
</style>
