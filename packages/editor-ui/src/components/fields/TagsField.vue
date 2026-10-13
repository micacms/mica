<script setup lang="ts">
/**
 * A free list of tags. Enter or a comma adds what was typed; each tag has its
 * own remove button, and Backspace in the empty input removes the last one.
 * Suggestions come from the model as a datalist, so any browser offers them.
 */

import { computed, ref } from "vue";
import { X } from "@lucide/vue";

import type { TagsField } from "@micacms/core";

import FieldShell from "./FieldShell.vue";
import { useField, type FieldProps } from "@/composables/useField";

const props = defineProps<FieldProps & { modelValue: unknown }>();
const emit = defineEmits<{ "update:modelValue": [string[]] }>();

const field = computed(() => props.field as TagsField);
const { inputId, label, error: ownError, describedBy: ownDescribedBy, hintId, errorId, locked } = useField(props);

/** The list's own problem, or one of a single tag (`tags.2`), which names the tag in its message. */
const error = computed(
  () => ownError.value ?? props.issues?.find((issue) => issue.path.startsWith(`${props.path}.`))?.message ?? null,
);
const usageId = `${inputId}-usage`;
const describedBy = computed(() =>
  [ownDescribedBy.value, !ownError.value && error.value ? errorId : null, usageId].filter(Boolean).join(" ") || undefined,
);

const tags = computed<string[]>(() =>
  Array.isArray(props.modelValue) ? props.modelValue.filter((tag): tag is string => typeof tag === "string") : [],
);
const draft = ref("");
const full = computed(() => field.value.max !== undefined && tags.value.length >= field.value.max);
const listId = `${inputId}-suggestions`;

/** Adds what was typed, split at commas as `mica import` does; empty and repeated tags (in any case) are left out. */
function add(): void {
  const next = [...tags.value];
  for (const part of draft.value.split(",")) {
    const tag = part.trim();
    if (!tag || (field.value.max !== undefined && next.length >= field.value.max)) continue;
    if (next.some((existing) => existing.toLowerCase() === tag.toLowerCase())) continue;
    next.push(tag);
  }
  draft.value = "";
  if (next.length !== tags.value.length) emit("update:modelValue", next);
}

function remove(index: number): void {
  emit("update:modelValue", tags.value.filter((_, at) => at !== index));
}

function onKeydown(event: KeyboardEvent): void {
  // Enter that ends an input method's composition is not the end of a tag.
  if (event.isComposing || locked.value) return;
  if (event.key === "Enter" || event.key === ",") {
    event.preventDefault();
    add();
  } else if (event.key === "Backspace" && draft.value === "" && tags.value.length > 0) {
    remove(tags.value.length - 1);
  }
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
    <div :class="['input flex flex-wrap items-center gap-1.5', error && 'input-invalid']">
      <span v-if="tags.length" class="sr-only">{{ label }}: {{ tags.length }} tag{{ tags.length === 1 ? "" : "s" }}</span>
      <ul v-if="tags.length" class="contents">
        <li
          v-for="(tag, index) in tags"
          :key="`${index}:${tag}`"
          class="inline-flex items-center gap-1 rounded-sm border border-line bg-canvas px-2 py-0.5 text-sm"
        >
          {{ tag }}
          <button v-if="!locked" type="button" class="text-muted hover:text-ink" @click="remove(index)">
            <X :size="12" aria-hidden="true" />
            <span class="sr-only">Remove {{ tag }}</span>
          </button>
        </li>
      </ul>
      <input
        :id="inputId"
        v-model="draft"
        type="text"
        class="min-w-24 flex-1 border-0 bg-transparent p-0 text-sm outline-none focus:ring-0"
        :list="field.suggestions?.length ? listId : undefined"
        :maxlength="field.maxLength"
        :placeholder="full ? '' : 'Add a tag'"
        :readonly="locked || full"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        @keydown="onKeydown"
        @blur="add"
      />
      <datalist v-if="field.suggestions?.length" :id="listId">
        <option v-for="suggestion in field.suggestions" :key="suggestion" :value="suggestion" />
      </datalist>
    </div>
    <p v-if="!locked" :id="usageId" class="field-hint">
      {{ full ? `The most is ${field.max}.` : "Press Enter or type a comma after each tag." }}
    </p>
  </FieldShell>
</template>
