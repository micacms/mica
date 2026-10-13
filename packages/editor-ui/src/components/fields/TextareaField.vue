<script setup lang="ts">
import { computed } from "vue";

import type { TextareaField } from "@micacms/core";

import FieldShell from "./FieldShell.vue";
import { useField, type FieldProps } from "@/composables/useField";

const props = defineProps<FieldProps & { modelValue: unknown }>();
const emit = defineEmits<{ "update:modelValue": [string | null] }>();

const field = computed(() => props.field as TextareaField);
const { inputId, label, error, describedBy, hintId, errorId, locked } = useField(props);

const value = computed(() => (typeof props.modelValue === "string" ? props.modelValue : ""));

const showCounter = computed(
  () => field.value.maxLength !== undefined && value.value.length > field.value.maxLength * 0.7,
);

function onInput(event: Event): void {
  const next = (event.target as HTMLTextAreaElement).value;
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
    <textarea
      :id="inputId"
      :value="value"
      :rows="field.rows ?? 4"
      :placeholder="field.placeholder"
      :maxlength="field.maxLength"
      :required="field.required"
      :readonly="locked"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="describedBy"
      :class="['input resize-y', error && 'input-invalid']"
      @input="onInput"
    />

    <p v-if="showCounter" class="mt-1 text-right text-xs text-muted">
      {{ value.length }} / {{ field.maxLength }}
    </p>
  </FieldShell>
</template>
