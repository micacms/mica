<script setup lang="ts">
defineProps<{
  title: string;
  subtitle?: string | null;
  /** Rendered as a back link above the title. */
  back?: { name: string; params?: Record<string, string> } | null;
  backLabel?: string;
}>();
</script>

<template>
  <header class="border-b border-line bg-surface">
    <div class="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
      <div class="min-w-0 flex-1">
        <RouterLink
          v-if="back"
          :to="back"
          class="mb-0.5 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-ink"
        >
          <svg viewBox="0 0 20 20" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5l-5 5 5 5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          {{ backLabel ?? "Back" }}
        </RouterLink>

        <h1 class="truncate text-xl font-semibold tracking-tight">{{ title }}</h1>
        <p v-if="subtitle" class="mt-0.5 truncate text-sm text-muted">{{ subtitle }}</p>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <slot />
      </div>
    </div>
  </header>
</template>
