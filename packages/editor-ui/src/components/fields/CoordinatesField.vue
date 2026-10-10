<script setup lang="ts">
/**
 * Geographic position.
 *
 * Stores neutral coordinates, never provider-specific map data, so the
 * frontend is free to render them with MapLibre, a static image, or nothing.
 *
 * No map is embedded here: a slippy map needs a tile provider, and making the
 * admin depend on a third-party endpoint at runtime would undercut the
 * "no mandatory external services" principle. Pasting a coordinate pair from
 * any map covers the actual editorial task.
 */

import { computed } from "vue";

import type { Coordinates, CoordinatesField } from "@micacms/core";

import FieldShell from "./FieldShell.vue";
import { useField, type FieldProps } from "@/composables/useField";

const props = defineProps<FieldProps & { modelValue: unknown }>();
const emit = defineEmits<{ "update:modelValue": [Coordinates | null] }>();

const field = computed(() => props.field as CoordinatesField);
const { inputId, label, error, describedBy, hintId, errorId } = useField(props);

const current = computed<Coordinates | null>(() => {
  const value = props.modelValue;
  if (!value || typeof value !== "object") return null;
  const { lat, lng } = value as Partial<Coordinates>;
  return typeof lat === "number" && typeof lng === "number" ? { lat, lng } : null;
});

// Issues on the nested keys are reported as `path.lat` / `path.lng`.
const partError = (part: "lat" | "lng") =>
  props.issues?.find((issue) => issue.path === `${props.path}.${part}`)?.message ?? null;

function update(part: "lat" | "lng", raw: string): void {
  const parsed = Number(raw);
  const base = current.value ?? { lat: 0, lng: 0 };

  if (raw.trim() === "") {
    // Clearing either half clears the pair — a half-set coordinate is not a place.
    emit("update:modelValue", null);
    return;
  }

  if (!Number.isFinite(parsed)) return;
  emit("update:modelValue", { ...base, [part]: parsed });
}

/** Accepts "47.3769, 8.5417" as pasted from any mapping site. */
function onPaste(event: ClipboardEvent): void {
  const text = event.clipboardData?.getData("text") ?? "";
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!match) return;

  event.preventDefault();
  emit("update:modelValue", { lat: Number(match[1]), lng: Number(match[2]) });
}

const previewUrl = computed(() =>
  current.value
    ? `https://www.openstreetmap.org/?mlat=${current.value.lat}&mlon=${current.value.lng}#map=16/${current.value.lat}/${current.value.lng}`
    : null,
);
</script>

<template>
  <FieldShell
    :input-id="inputId"
    :label="label"
    :description="field.description"
    :required="field.required"
    :error="error"
    :hint-id="hintId"
    :error-id="errorId"
  >
    <div class="grid grid-cols-2 gap-2">
      <div>
        <label :for="`${inputId}-lat`" class="sr-only">Latitude</label>
        <input
          :id="`${inputId}-lat`"
          type="number"
          step="any"
          min="-90"
          max="90"
          placeholder="Latitude"
          :value="current?.lat ?? ''"
          :disabled="disabled || field.readonly"
          :aria-describedby="describedBy"
          :class="['input font-mono text-[13px]', partError('lat') && 'input-invalid']"
          @input="update('lat', ($event.target as HTMLInputElement).value)"
          @paste="onPaste"
        />
      </div>
      <div>
        <label :for="`${inputId}-lng`" class="sr-only">Longitude</label>
        <input
          :id="`${inputId}-lng`"
          type="number"
          step="any"
          min="-180"
          max="180"
          placeholder="Longitude"
          :value="current?.lng ?? ''"
          :disabled="disabled || field.readonly"
          :class="['input font-mono text-[13px]', partError('lng') && 'input-invalid']"
          @input="update('lng', ($event.target as HTMLInputElement).value)"
          @paste="onPaste"
        />
      </div>
    </div>

    <p v-if="partError('lat') || partError('lng')" class="field-error">
      {{ partError("lat") ?? partError("lng") }}
    </p>

    <div class="mt-1.5 flex items-center gap-3 text-xs text-muted">
      <span>Paste "47.3769, 8.5417" into either box to fill both.</span>
      <a
        v-if="previewUrl"
        :href="previewUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="font-medium text-accent underline underline-offset-2"
      >
        Check on the map
      </a>
      <button
        v-if="current"
        type="button"
        class="ml-auto font-medium hover:text-ink"
        @click="emit('update:modelValue', null)"
      >
        Clear
      </button>
    </div>
  </FieldShell>
</template>
