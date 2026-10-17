<script setup lang="ts">
/**
 * The map below the coordinates inputs, when the field has `map`. MapLibre
 * loads only when this shows. The inputs stay the way to enter a value with
 * the keyboard; the map adds to them.
 */

import { onBeforeUnmount, onMounted, ref, watch } from "vue";

import { resolveMap, type Coordinates, type CoordinatesField } from "@micacms/core/internal";

import type { PickerMap } from "@/lib/picker-map";

const props = defineProps<{ map: NonNullable<CoordinatesField["map"]>; value: Coordinates | null; locked: boolean }>();
const emit = defineEmits<{ pick: [Coordinates] }>();

const container = ref<HTMLElement | null>(null);
const failed = ref(false);
let picker: PickerMap | null = null;
let unmounted = false;

function fail(): void {
  failed.value = true;
  picker?.remove();
  picker = null;
}

onMounted(async () => {
  try {
    const { createPickerMap } = await import("@/lib/picker-map");
    if (unmounted || !container.value) return;
    picker = createPickerMap({
      container: container.value,
      style: resolveMap(props.map).style,
      value: props.value,
      locked: props.locked,
      onPick: (value) => emit("pick", value),
      onFail: fail,
    });
  } catch {
    // The chunk did not load, or the browser cannot draw the map.
    fail();
  }
});

watch(
  () => props.value,
  (value) => picker?.show(value),
  { deep: true },
);
watch(
  () => props.locked,
  (locked) => picker?.lock(locked),
);

onBeforeUnmount(() => {
  unmounted = true;
  picker?.remove();
  picker = null;
});
</script>

<template>
  <div class="mt-2">
    <p v-if="failed" class="text-xs text-muted" role="status">
      The map did not load. You can still type the coordinates.
    </p>
    <template v-else>
      <div ref="container" class="h-64 overflow-hidden rounded-md border border-line bg-subtle" />
      <p v-if="!locked" class="mt-1.5 text-xs text-muted">Click the map to set the place, or drag the pin.</p>
    </template>
  </div>
</template>
