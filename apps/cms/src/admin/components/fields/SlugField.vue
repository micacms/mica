<script setup lang="ts">
/**
 * URL field.
 *
 * Follows the source field until the editor takes it over by hand, which is the
 * behaviour that keeps URLs tidy without ever surprising someone who has
 * deliberately set one. Generation happens on the server so the preview matches
 * exactly what will be stored, including de-duplication.
 */

import { computed, ref, watch } from "vue";

import type { SlugField } from "@micacms/model";

import FieldShell from "./FieldShell.vue";
import { api } from "@/api";
import { useField, type FieldProps } from "@/composables/useField";

const props = defineProps<
  FieldProps & {
    modelValue: unknown;
    /** Current value of the field named in `from`. */
    source?: string | null;
    collection?: string;
    /** Slug of the entry being edited, excluded from the uniqueness check. */
    exceptSlug?: string;
  }
>();

const emit = defineEmits<{ "update:modelValue": [string | null] }>();

const field = computed(() => props.field as SlugField);
const { inputId, label, error, describedBy, hintId, errorId } = useField(props);

const value = computed(() => (typeof props.modelValue === "string" ? props.modelValue : ""));

// Once the editor edits the URL directly, stop following the title.
const locked = ref(value.value !== "");
let pending: ReturnType<typeof setTimeout> | undefined;

watch(
  () => props.source,
  (source) => {
    if (locked.value || !field.value.from || !props.collection) return;
    if (!source?.trim()) {
      emit("update:modelValue", null);
      return;
    }

    clearTimeout(pending);
    pending = setTimeout(async () => {
      try {
        const { slug } = await api.entries.suggestSlug(props.collection!, source, props.exceptSlug);
        if (!locked.value) emit("update:modelValue", slug || null);
      } catch {
        // A failed suggestion is not worth interrupting typing over; the
        // server derives the slug again on save.
      }
    }, 300);
  },
);

function onInput(event: Event): void {
  locked.value = true;
  const next = (event.target as HTMLInputElement).value;
  emit("update:modelValue", next === "" ? null : next);
}

function unlock(): void {
  locked.value = false;
  emit("update:modelValue", null);
  // Re-derive immediately from the current title.
  if (props.source?.trim() && props.collection) {
    void api.entries
      .suggestSlug(props.collection, props.source, props.exceptSlug)
      .then(({ slug }) => emit("update:modelValue", slug || null));
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
    <div class="flex items-stretch">
      <span
        class="inline-flex select-none items-center rounded-l-lg border border-r-0 border-line bg-canvas px-3 text-sm text-muted"
        aria-hidden="true"
      >
        /
      </span>
      <input
        :id="inputId"
        type="text"
        :value="value"
        :maxlength="field.maxLength ?? 96"
        :disabled="disabled || field.readonly"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        :class="['input rounded-l-none font-mono text-[13px]', error && 'input-invalid']"
        spellcheck="false"
        autocomplete="off"
        @input="onInput"
      />
      <button
        v-if="locked && field.from"
        type="button"
        class="btn-ghost ml-2 shrink-0 whitespace-nowrap"
        :disabled="disabled"
        @click="unlock"
      >
        Reset
      </button>
    </div>

    <p v-if="!locked && field.from" class="field-hint">
      Generated from the {{ field.from }}. Edit it to set your own.
    </p>
  </FieldShell>
</template>
