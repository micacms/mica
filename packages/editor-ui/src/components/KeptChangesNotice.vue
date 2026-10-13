<script setup lang="ts">
/** "You have changes from before": restore the values this tab kept, or let them go. */

import { relativeTime } from "@/lib/format";

defineProps<{ at: string }>();
const emit = defineEmits<{ restore: []; forget: [] }>();
</script>

<template>
  <div role="status" class="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-accent/20 bg-accent-soft px-4 py-3">
    <p class="min-w-0 flex-1 text-sm">
      You have changes from {{ relativeTime(at) }} that were not saved.
    </p>
    <button type="button" class="btn-secondary" @click="emit('restore')">Restore them</button>
    <button type="button" class="btn-ghost" @click="emit('forget')">Let them go</button>
  </div>
</template>
