<script setup lang="ts">
/**
 * Media field. Binds to ids; thumbnails come from the form's media registry.
 */

import { computed, ref } from "vue";

import type { MediaField, MediaRef } from "@micacms/model";

import FieldShell from "./FieldShell.vue";
import MediaPicker from "@/components/MediaPicker.vue";
import { useMediaRegistry } from "@/composables/mediaRegistry";
import { useField, type FieldProps } from "@/composables/useField";

const props = defineProps<FieldProps & { modelValue: unknown }>();
const emit = defineEmits<{ "update:modelValue": [string | string[] | null] }>();

const field = computed(() => props.field as MediaField);
const { inputId, label, error, describedBy, hintId, errorId } = useField(props);
const registry = useMediaRegistry();

const pickerOpen = ref(false);

const ids = computed<string[]>(() => {
  if (field.value.multiple) {
    return Array.isArray(props.modelValue) ? (props.modelValue as string[]) : [];
  }
  return typeof props.modelValue === "string" ? [props.modelValue] : [];
});

/** An id with no known reference means the file was deleted underneath us. */
const refs = computed(() =>
  ids.value.map((id) => ({ id, ref: registry.resolve(id) as MediaRef | undefined })),
);

const atLimit = computed(
  () => field.value.multiple && field.value.max !== undefined && ids.value.length >= field.value.max,
);

function onChoose(chosen: MediaRef[]): void {
  registry.add(chosen);

  if (!field.value.multiple) {
    emit("update:modelValue", chosen[0]?.id ?? null);
    return;
  }

  // Skip anything already present rather than duplicating it.
  const next = [...ids.value];
  for (const item of chosen) if (!next.includes(item.id)) next.push(item.id);
  emit("update:modelValue", field.value.max ? next.slice(0, field.value.max) : next);
}

function removeAt(index: number): void {
  if (!field.value.multiple) {
    emit("update:modelValue", null);
    return;
  }
  emit(
    "update:modelValue",
    ids.value.filter((_, position) => position !== index),
  );
}

function move(index: number, direction: -1 | 1): void {
  const target = index + direction;
  if (target < 0 || target >= ids.value.length) return;

  const next = [...ids.value];
  [next[index], next[target]] = [next[target]!, next[index]!];
  emit("update:modelValue", next);
}
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
    <div :aria-describedby="describedBy">
      <ul
        v-if="refs.length"
        :class="[
          'mb-2 gap-2',
          field.multiple ? 'grid grid-cols-3 sm:grid-cols-5' : 'flex',
        ]"
      >
        <li
          v-for="(item, index) in refs"
          :key="`${item.id}-${index}`"
          :class="[
            'group relative overflow-hidden rounded-lg border border-line bg-canvas',
            field.multiple ? '' : 'w-40',
          ]"
        >
          <div class="aspect-4/3">
            <img
              v-if="item.ref?.mimeType.startsWith('image/')"
              :src="item.ref.url"
              :alt="item.ref.alt ?? ''"
              class="h-full w-full object-cover"
            />
            <div
              v-else
              class="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center"
            >
              <span class="text-[11px] font-semibold uppercase text-muted">
                {{ item.ref ? item.ref.mimeType.split("/")[1] : "missing" }}
              </span>
              <span v-if="!item.ref" class="text-[10px] text-danger">
                File deleted
              </span>
            </div>
          </div>

          <p v-if="item.ref" class="truncate px-1.5 py-1 text-[11px] text-muted">
            {{ item.ref.filename }}
          </p>

          <!-- Controls are always in the DOM so they are reachable by keyboard,
               and only fade in visually on hover/focus. -->
          <div
            class="absolute inset-x-0 top-0 flex justify-end gap-0.5 bg-gradient-to-b from-black/50 to-transparent p-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100"
          >
            <button
              v-if="field.multiple && index > 0"
              type="button"
              class="rounded bg-white/90 px-1.5 text-xs font-semibold hover:bg-white"
              :disabled="disabled"
              @click="move(index, -1)"
            >
              ←<span class="sr-only">Move {{ item.ref?.filename }} earlier</span>
            </button>
            <button
              v-if="field.multiple && index < refs.length - 1"
              type="button"
              class="rounded bg-white/90 px-1.5 text-xs font-semibold hover:bg-white"
              :disabled="disabled"
              @click="move(index, 1)"
            >
              →<span class="sr-only">Move {{ item.ref?.filename }} later</span>
            </button>
            <button
              type="button"
              class="rounded bg-white/90 px-1.5 text-xs font-semibold text-danger hover:bg-white"
              :disabled="disabled"
              @click="removeAt(index)"
            >
              ×<span class="sr-only">Remove {{ item.ref?.filename ?? "file" }}</span>
            </button>
          </div>
        </li>
      </ul>

      <button
        :id="inputId"
        type="button"
        class="btn-secondary"
        :disabled="disabled || field.readonly || atLimit"
        @click="pickerOpen = true"
      >
        <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.75">
          <path d="M10 4v12M4 10h12" stroke-linecap="round" />
        </svg>
        {{ refs.length && !field.multiple ? "Replace" : "Add" }}
      </button>

      <span v-if="atLimit" class="ml-2 text-xs text-muted">
        Maximum of {{ field.max }} reached.
      </span>
    </div>

    <MediaPicker
      :open="pickerOpen"
      :accept="field.accept ?? 'any'"
      :multiple="field.multiple"
      :selected="ids"
      @close="pickerOpen = false"
      @choose="onChoose"
    />
  </FieldShell>
</template>
