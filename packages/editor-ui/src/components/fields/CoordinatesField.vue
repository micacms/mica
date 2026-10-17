<script setup lang="ts">
/**
 * Geographic position.
 *
 * Stores neutral coordinates, never provider-specific map data, so the
 * frontend is free to render them with MapLibre, a static image, or nothing.
 *
 * A map shows only when the field has `map`: it loads a tile host, and the
 * site owner chooses that host. The inputs and paste work with or without it.
 */

import { computed, ref, watch } from "vue";

import type { Coordinates, CoordinatesField } from "@micacms/core/internal";

import CoordinatesMap from "./CoordinatesMap.vue";
import FieldShell from "./FieldShell.vue";
import { useField, type FieldProps } from "@/composables/useField";
import { coordinatesFrom } from "@/lib/format";

const props = defineProps<FieldProps & { modelValue: unknown }>();
const emit = defineEmits<{ "update:modelValue": [Coordinates | { lat: number | null; lng: number | null } | null] }>();

const field = computed(() => props.field as CoordinatesField);
const { inputId, label, error, describedBy, hintId, errorId, locked } = useField(props);

const current = computed<Coordinates | null>(() => {
  const value = props.modelValue;
  if (!value || typeof value !== "object") return null;
  const { lat, lng, zoom } = value as Partial<Coordinates>;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return typeof zoom === "number" ? { lat, lng, zoom } : { lat, lng };
});

// Issues on the nested keys are reported as `path.lat` / `path.lng`.
const partError = (part: "lat" | "lng") =>
  props.issues?.find((issue) => issue.path === `${props.path}.${part}`)?.message ?? null;

/**
 * What the two boxes show. It follows the value, except where the editor's text
 * means the same number ("47." is 47), so typing is never interrupted.
 */
const typed = ref({ lat: "", lng: "" });
const textOf = (part: unknown) => (typeof part === "number" ? String(part) : "");
const sameAs = (text: string, part: unknown) => (text.trim() === "" ? typeof part !== "number" : Number(text) === part);
watch(
  () => props.modelValue,
  (value) => {
    const pair = value !== null && typeof value === "object" ? (value as { lat?: unknown; lng?: unknown }) : {};
    if (sameAs(typed.value.lat, pair.lat) && sameAs(typed.value.lng, pair.lng)) return;
    typed.value = { lat: textOf(pair.lat), lng: textOf(pair.lng) };
  },
  { immediate: true, deep: true },
);

/** A new place keeps the zoom that the map stored. */
function withZoom<T extends object | null>(pair: T): T {
  const zoom = (props.modelValue as { zoom?: unknown } | null)?.zoom;
  return pair !== null && typeof zoom === "number" ? { ...pair, zoom } : pair;
}

function update(part: "lat" | "lng", raw: string): void {
  typed.value = { ...typed.value, [part]: raw };
  const pair = coordinatesFrom(typed.value.lat, typed.value.lng);
  if (pair !== undefined) emit("update:modelValue", withZoom(pair));
}

/** Accepts "47.3769, 8.5417" as pasted from any mapping site. */
function onPaste(event: ClipboardEvent): void {
  if (locked.value) return;
  const text = event.clipboardData?.getData("text") ?? "";
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!match) return;

  event.preventDefault();
  emit("update:modelValue", withZoom({ lat: Number(match[1]), lng: Number(match[2]) }));
}

const previewUrl = computed(() =>
  current.value
    ? `https://www.openstreetmap.org/?mlat=${current.value.lat}&mlon=${current.value.lng}#map=16/${current.value.lat}/${current.value.lng}`
    : null,
);
</script>

<template>
  <FieldShell
    as="group"
    :described-by="describedBy"
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
          :value="typed.lat"
          :readonly="locked"
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
          :value="typed.lng"
          :readonly="locked"
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
        class="ml-auto font-medium hover:text-ink disabled:opacity-40"
        :disabled="locked"
        @click="emit('update:modelValue', null)"
      >
        Clear
      </button>
    </div>

    <CoordinatesMap
      v-if="field.map"
      :map="field.map"
      :value="current"
      :locked="locked"
      @pick="emit('update:modelValue', $event)"
    />
  </FieldShell>
</template>
