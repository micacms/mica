<script setup lang="ts">
/** The left end of a row in a list that can be reordered: drag it, or press Space and use the arrow keys. */
import { GripVertical } from "@lucide/vue";

defineProps<{ label: string; describedBy: string; disabled?: boolean; overlay?: boolean }>();
</script>

<template>
  <button
    type="button"
    :class="[
      'cursor-grab active:cursor-grabbing',
      overlay ? 'rounded-sm bg-raised/90 px-1.5 hover:bg-raised disabled:opacity-40' : 'btn-ghost px-1 py-0.5',
    ]"
    :aria-label="`Move “${label}”`"
    title="Drag, or press Space and use the arrow keys"
    :aria-describedby="describedBy"
    :disabled="disabled"
  >
    <GripVertical :size="overlay ? 14 : 16" aria-hidden="true" />
  </button>
</template>
