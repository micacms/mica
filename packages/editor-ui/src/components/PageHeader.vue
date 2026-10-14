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
}>();

const route = useRoute();
const heading = ref<HTMLElement | null>(null);

// A fixed route title wins ("Overview" over a greeting); else the page and the collection it belongs to.
const pageTitle = computed(() => {
  const fixed = typeof route.meta.title === "string" ? route.meta.title : null;
  return (fixed ? [fixed] : [props.title, props.back ? props.backLabel : null]).filter(Boolean).join(" · ");
});

watchEffect(() => {
  document.title = `${pageTitle.value} · Mica`;
});

function arrive(): void {
  if (!props.loading && heading.value) pageArrived(heading.value, pageTitle.value);
}

onMounted(arrive);
watch(() => props.loading, arrive, { flush: "post" });
</script>

<template>
  <header class="border-b border-line bg-raised">
    <div class="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
      <div class="min-w-0 flex-1">
        <RouterLink
          v-if="back"
          :to="back"
          class="mb-0.5 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink"
        >
          <ChevronLeft :size="14" aria-hidden="true" />
          {{ backLabel ?? "Back" }}
        </RouterLink>

        <h1 ref="heading" tabindex="-1" class="truncate text-[22px] leading-7 font-semibold">
          {{ title }}
        </h1>
        <p v-if="subtitle" class="mt-1 truncate text-xs text-muted">{{ subtitle }}</p>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <slot />
      </div>
    </div>
  </header>
</template>
