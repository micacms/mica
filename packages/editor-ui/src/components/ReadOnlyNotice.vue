<script setup lang="ts">
/** Why this collection or singleton cannot be edited here: the model is newer than this Mica. */
defineProps<{ reason: string }>();
</script>

<template>
  <div role="status" class="mb-5 rounded-md border border-warning/15 bg-warning-soft p-4">
    <p class="text-sm font-medium text-warning">Read-only in this version of Mica</p>
    <p class="mt-1 text-xs text-muted">{{ reason }}</p>
  </div>
</template>
