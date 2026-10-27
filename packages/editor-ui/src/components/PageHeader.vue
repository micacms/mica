<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, watchEffect } from "vue";
import { useRoute } from "vue-router";
import { ChevronLeft } from "@lucide/vue";

import { pageArrived } from "@/lib/announce";

const props = defineProps<{
  title: string;
  subtitle?: string | null;
  /** Rendered as a back link above the title. */
  back?: { name: string; params?: Record<string, string> } | null;
  backLabel?: string;
  /** While true, the title is not final, so the page is announced later. */
  loading?: boolean;
  /** In the overlay form: the page keeps its own title and announcement. */
  embedded?: boolean;
  /** The header of a form: as wide as the form, so that the title and the fields align. */
  form?: boolean;
}>();

const route = useRoute();
const heading = ref<HTMLElement | null>(null);

// A fixed route title wins ("Overview" over a greeting); else the page and the collection it belongs to.
const pageTitle = computed(() => {
  const fixed = typeof route.meta.title === "string" ? route.meta.title : null;
  return (fixed ? [fixed] : [props.title, props.back ? props.backLabel : null]).filter(Boolean).join(" · ");
});

watchEffect(() => {
  if (!props.embedded) document.title = `${pageTitle.value} · Mica`;
});

function arrive(): void {
  if (!props.loading && !props.embedded && heading.value) pageArrived(heading.value, pageTitle.value);
}

onMounted(arrive);

// Where the sticky header ends, for `scroll-padding-top`: its height changes with the language row and the width.
const header = ref<HTMLElement | null>(null);
const resized = new ResizeObserver(() => {
  const element = header.value;
  if (!element) return;
  const end = (Number.parseFloat(getComputedStyle(element).top) || 0) + element.offsetHeight;
  document.documentElement.style.setProperty("--page-header-end", `${end}px`);
});
onMounted(() => {
  if (!props.embedded && header.value) resized.observe(header.value);
});
onBeforeUnmount(() => {
  resized.disconnect();
  if (!props.embedded) document.documentElement.style.removeProperty("--page-header-end");
});
watch(() => props.loading, arrive, { flush: "post" });
</script>

<template>
  <!-- Sticky, so that the title and the status stay in view: below the phone's menu bar, or at the top of the overlay form. -->
  <header ref="header" :class="['@container sticky z-10 border-b border-line bg-raised', embedded ? 'top-0' : 'top-14 lg:top-0']">
    <!--
      By the header's own width, as a wide preview narrows the form: in a narrow header, the actions share the title's
      line when they fit beside 12rem of it, else they have a line of their own; in a wide one, they are always on
      the title's line. A status that changes while the editor types must not wrap the header: the `meta` line under
      the title does not wrap.
    -->
    <div :class="['mx-auto flex flex-wrap items-center gap-x-4 gap-y-3 px-4 @xl:flex-nowrap @xl:px-6', form ? 'max-w-3xl' : 'max-w-5xl', embedded || form ? 'py-3' : 'py-4']">
      <div class="min-w-0 flex-1 basis-48">
        <RouterLink
          v-if="back"
          :to="back"
          class="mb-0.5 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink"
        >
          <ChevronLeft :size="14" aria-hidden="true" />
          {{ backLabel ?? "Back" }}
        </RouterLink>

        <component :is="embedded ? 'h2' : 'h1'" ref="heading" tabindex="-1" :class="['truncate font-semibold', embedded ? 'text-lg leading-6' : 'text-[22px] leading-7']">
          {{ title }}
        </component>
        <p v-if="subtitle" class="mt-1 text-xs break-words text-muted">{{ subtitle }}</p>
        <div v-if="$slots.meta" class="mt-1 flex min-w-0 items-center gap-2">
          <slot name="meta" />
        </div>
      </div>

      <div v-if="$slots.default" class="flex shrink-0 flex-wrap items-center gap-2 whitespace-nowrap @xl:flex-nowrap">
        <slot />
      </div>
    </div>

    <!-- What the whole form shows, such as its language: it stays in view while the form scrolls. -->
    <div v-if="$slots.toolbar" class="border-t border-line">
      <div :class="['mx-auto px-4 py-2 @xl:px-6', form ? 'max-w-3xl' : 'max-w-5xl']">
        <slot name="toolbar" />
      </div>
    </div>
  </header>
</template>
