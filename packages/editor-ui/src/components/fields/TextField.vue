<script setup lang="ts">
/** Covers `text`, `email` and `url` — same control, different input type. */

import { computed } from "vue";

import type { EmailField, TextField, UrlField } from "@micacms/core";

import FieldShell from "./FieldShell.vue";
import { useField, type FieldProps } from "@/composables/useField";

const props = defineProps<FieldProps & { modelValue: unknown }>();
const emit = defineEmits<{ "update:modelValue": [string | null] }>();

const field = computed(() => props.field as TextField | EmailField | UrlField);
const { inputId, label, error, describedBy, hintId, errorId, locked } = useField(props);

const inputType = computed(() =>
  field.value.kind === "email" ? "email" : field.value.kind === "url" ? "url" : "text",
);

const value = computed(() => (typeof props.modelValue === "string" ? props.modelValue : ""));

const maxLength = computed(() =>
  "maxLength" in field.value ? (field.value.maxLength ?? null) : null,
);

// Only worth showing as the limit gets close.
const showCounter = computed(
  () => maxLength.value !== null && value.value.length > maxLength.value * 0.7,
);

function onInput(event: Event): void {
  const next = (event.target as HTMLInputElement).value;
  // Blank means "not filled in"; the model treats null as the empty state.
  emit("update:modelValue", next === "" ? null : next);
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
    <input
      :id="inputId"
      :type="inputType"
      :value="value"
      :placeholder="'placeholder' in field ? field.placeholder : undefined"
      :maxlength="maxLength ?? undefined"
      :required="field.required"
      :readonly="locked"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="describedBy"
      :class="['input', error && 'input-invalid']"
      autocomplete="off"
      @input="onInput"
    />

    <p v-if="showCounter" class="mt-1 text-right text-xs text-muted">
      {{ value.length }} / {{ maxLength }}
    </p>
  </FieldShell>
</template>
