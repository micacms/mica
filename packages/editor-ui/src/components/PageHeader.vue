<script setup lang="ts">
import { ChevronLeft } from "@lucide/vue";

defineProps<{
  title: string;
  subtitle?: string | null;
  /** Rendered as a back link above the title. */
  back?: { name: string; params?: Record<string, string> } | null;
  backLabel?: string;
}>();
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

        <h1 class="truncate font-display text-2xl font-normal leading-8 tracking-tight">{{ title }}</h1>
        <p v-if="subtitle" class="mt-1 truncate text-xs text-muted">{{ subtitle }}</p>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <slot />
      </div>
    </div>
  </header>
</template>
