<script setup lang="ts">
/**
 * Media field.
 *
 * The value is a path into the content repository. There is no registry and no
 * id to resolve any more: the path *is* the reference, the preview URL follows
 * from it, and the filename is its last segment. A whole layer of indirection
 * went away with the media table.
 */

import { computed, ref } from "vue";

import type { MediaField } from "@micacms/model";

import FieldShell from "./FieldShell.vue";
import MediaPicker from "@/components/MediaPicker.vue";
import { api, type MediaItem } from "@/api";
import { useField, type FieldProps } from "@/composables/useField";

const props = defineProps<FieldProps & { modelValue: unknown }>();
const emit = defineEmits<{ "update:modelValue": [string | string[] | null] }>();

const field = computed(() => props.field as MediaField);
const { inputId, label, error, describedBy, hintId, errorId } = useField(props);

const pickerOpen = ref(false);

const paths = computed<string[]>(() => {
  if (field.value.multiple) {
    return Array.isArray(props.modelValue) ? (props.modelValue as string[]) : [];
  }
  return typeof props.modelValue === "string" && props.modelValue ? [props.modelValue] : [];
});

const items = computed(() =>
  paths.value.map((path) => ({
    path,
    filename: path.split("/").pop() ?? path,
    url: api.media.url(path),
    // From the extension: the picker knows the real type, but a field rendering
    // a saved path has only the path.
    isImage: /\.(jpe?g|png|webp|avif|gif|svg)$/i.test(path),
  })),
);

const atLimit = computed(
  () =>
    field.value.multiple && field.value.max !== undefined && paths.value.length >= field.value.max,
);

function onChoose(chosen: MediaItem[]): void {
  if (!field.value.multiple) {
    emit("update:modelValue", chosen[0]?.path ?? null);
    return;
  }

  // Skip anything already present rather than duplicating it.
  const next = [...paths.value];
  for (const item of chosen) if (!next.includes(item.path)) next.push(item.path);
  emit("update:modelValue", field.value.max ? next.slice(0, field.value.max) : next);
}

function removeAt(index: number): void {
  if (!field.value.multiple) {
    emit("update:modelValue", null);
    return;
  }
  emit(
    "update:modelValue",
    paths.value.filter((_, position) => position !== index),
  );
}

function move(index: number, direction: -1 | 1): void {
  const target = index + direction;
  if (target < 0 || target >= paths.value.length) return;

  const next = [...paths.value];
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
        v-if="items.length"
        :class="[
          'mb-2 gap-2',
          field.multiple ? 'grid grid-cols-3 sm:grid-cols-5' : 'flex',
        ]"
      >
        <li
          v-for="(item, index) in items"
          :key="`${item.path}-${index}`"
          :class="[
            'group relative overflow-hidden rounded-lg border border-line bg-canvas',
            field.multiple ? '' : 'w-40',
          ]"
        >
          <div class="aspect-4/3">
            <img
              v-if="item.isImage"
              :src="item.url"
              alt=""
              class="h-full w-full object-cover"
            />
            <div
              v-else
              class="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center"
            >
              <span class="text-[11px] font-semibold uppercase text-muted">
                {{ item.filename.split(".").pop() }}
              </span>
            </div>
          </div>

          <p class="truncate px-1.5 py-1 text-[11px] text-muted" :title="item.path">
            {{ item.filename }}
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
              ←<span class="sr-only">Move {{ item.filename }} earlier</span>
            </button>
            <button
              v-if="field.multiple && index < items.length - 1"
              type="button"
              class="rounded bg-white/90 px-1.5 text-xs font-semibold hover:bg-white"
              :disabled="disabled"
              @click="move(index, 1)"
            >
              →<span class="sr-only">Move {{ item.filename }} later</span>
            </button>
            <button
              type="button"
              class="rounded bg-white/90 px-1.5 text-xs font-semibold text-danger hover:bg-white"
              :disabled="disabled"
              @click="removeAt(index)"
            >
              ×<span class="sr-only">Remove {{ item.filename }}</span>
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
        {{ items.length && !field.multiple ? "Replace" : "Add" }}
      </button>

      <span v-if="atLimit" class="ml-2 text-xs text-muted">
        Maximum of {{ field.max }} reached.
      </span>
    </div>

    <MediaPicker
      :open="pickerOpen"
      :accept="field.accept ?? 'any'"
      :multiple="field.multiple"
      :selected="paths"
      @close="pickerOpen = false"
      @choose="onChoose"
    />
  </FieldShell>
</template>
