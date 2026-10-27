<script setup lang="ts">
/** The number of missing translations in a group or a row, as a pill: the words are in its tooltip and for a screen reader. */

import { computed } from "vue";

const props = defineProps<{ count: number }>();

const text = computed(() => `${props.count} missing translation${props.count === 1 ? "" : "s"}`);
</script>

<template>
  <span class="group relative inline-flex shrink-0">
    <span class="count bg-glint text-on-glint" aria-hidden="true">{{ count }}</span>
    <span class="sr-only">{{ text }}</span>
    <span class="tooltip left-1/2 -translate-x-1/2 group-hover:tooltip-shown" aria-hidden="true">{{ text }}</span>
  </span>
</template>
