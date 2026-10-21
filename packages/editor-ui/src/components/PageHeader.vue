<script setup lang="ts">
import { computed, onMounted, ref, watch, watchEffect } from "vue";
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
watch(() => props.loading, arrive, { flush: "post" });
</script>

<template>
  <!-- Sticky, so that the title and the status stay in view: below the phone's menu bar, or at the top of the overlay form. -->
  <header :class="['@container sticky z-10 border-b border-line bg-raised', embedded ? 'top-0' : 'top-14 lg:top-0']">
    <!--
      By the header's own width, as a wide preview narrows the form: one line when the actions fit, else the actions
      always on a line of their own. A status that changes while the editor types must not wrap the header.
    -->
    <div :class="['mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-3 px-4 @xl:flex-nowrap @xl:px-6', embedded ? 'py-3' : 'py-4']">
      <div class="min-w-0 flex-1">
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
      </div>

      <div class="flex w-full shrink-0 items-center gap-2 whitespace-nowrap @xl:w-auto">
        <slot />
      </div>
    </div>
  </header>
</template>
