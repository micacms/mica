<script setup lang="ts">
/**
 * What a page or a list shows instead of its content: that it loads, that it
 * has nothing yet, or that it could not load, with "Try again". A view shows
 * "nothing yet" only after a load that worked: a failed load is an error.
 */
defineProps<{
  kind: "loading" | "empty" | "error";
  /** The main line, such as "No projects yet." or "The entries could not be loaded". */
  title?: string;
  /** More words under it: for an error, the reason. */
  message?: string;
}>();

const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <p v-if="kind === 'loading'" role="status" class="py-8 text-center text-sm text-muted">Loading…</p>

  <div v-else-if="kind === 'error'" role="alert" class="rounded-md border border-danger/15 bg-danger-soft p-4">
    <p class="text-sm font-medium text-danger">{{ title }}</p>
    <p v-if="message" class="mt-1 text-xs text-muted">{{ message }}</p>
    <button type="button" class="btn-secondary mt-2.5" @click="emit('retry')">Try again</button>
  </div>

  <div v-else class="px-4 py-12 text-center">
    <p class="text-sm font-medium">{{ title }}</p>
    <p v-if="message" class="mt-1 text-sm text-muted">{{ message }}</p>
    <slot />
  </div>
</template>
