<script setup lang="ts">
/** The right end of a row in a list that can be reordered: one step up or down, or earlier or later in a grid. */
import { computed } from "vue";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "@lucide/vue";

const props = defineProps<{
  label: string;
  target: string;
  first: boolean;
  last: boolean;
  disabled?: boolean;
  /** `grid`: arrows to the left and the right. `overlay`: on top of an image. */
  layout?: "list" | "grid";
  overlay?: boolean;
}>();
const emit = defineEmits<{ move: [direction: -1 | 1] }>();

const grid = computed(() => props.layout === "grid");
const button = computed(() =>
  props.overlay ? "rounded-sm bg-raised/90 px-1.5 hover:bg-raised disabled:opacity-40" : "btn-ghost px-1.5 py-1",
);
</script>

<template>
  <span class="flex shrink-0 items-center gap-0.5">
    <button type="button" :class="button" :data-reorder-up="target" :disabled="disabled || first" @click="emit('move', -1)">
      <component :is="grid ? ArrowLeft : ArrowUp" :size="overlay ? 14 : 16" aria-hidden="true" />
      <span class="sr-only">Move “{{ label }}” {{ grid ? "earlier" : "up" }}</span>
    </button>
    <button type="button" :class="button" :data-reorder-down="target" :disabled="disabled || last" @click="emit('move', 1)">
      <component :is="grid ? ArrowRight : ArrowDown" :size="overlay ? 14 : 16" aria-hidden="true" />
      <span class="sr-only">Move “{{ label }}” {{ grid ? "later" : "down" }}</span>
    </button>
  </span>
</template>
