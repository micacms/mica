<script setup lang="ts">
import { computed } from "vue";

import type { DateField } from "@micacms/model";

import FieldShell from "./FieldShell.vue";
import { useField, type FieldProps } from "@/composables/useField";

const props = defineProps<FieldProps & { modelValue: unknown }>();
const emit = defineEmits<{ "update:modelValue": [string | null] }>();

const field = computed(() => props.field as DateField);
const { inputId, label, error, describedBy, hintId, errorId } = useField(props);

/**
 * `datetime-local` has no timezone, but the model stores an ISO timestamp with
 * an offset. Convert in both directions so the editor sees local time and the
 * database keeps an unambiguous instant.
 */
const value = computed(() => {
  const stored = props.modelValue;
  if (typeof stored !== "string" || stored === "") return "";
  if (!field.value.includeTime) return stored.slice(0, 10);

  const date = new Date(stored);
  if (Number.isNaN(date.getTime())) return "";

  const pad = (part: number) => String(part).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
});

function onInput(event: Event): void {
  const raw = (event.target as HTMLInputElement).value;
  if (!raw) {
    emit("update:modelValue", null);
    return;
  }

  if (!field.value.includeTime) {
    emit("update:modelValue", raw);
    return;
  }

  const date = new Date(raw);
  emit("update:modelValue", Number.isNaN(date.getTime()) ? null : date.toISOString());
}

function setToday(): void {
  const now = new Date();
  emit(
    "update:modelValue",
    field.value.includeTime ? now.toISOString() : now.toISOString().slice(0, 10),
  );
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
    <div class="flex items-center gap-2">
      <input
        :id="inputId"
        :type="field.includeTime ? 'datetime-local' : 'date'"
        :value="value"
        :min="field.min"
        :max="field.max"
        :required="field.required"
        :disabled="disabled || field.readonly"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        :class="['input', error && 'input-invalid']"
        @input="onInput"
      />
      <button
        type="button"
        class="btn-secondary shrink-0"
        :disabled="disabled || field.readonly"
        @click="setToday"
      >
        Today
      </button>
    </div>
  </FieldShell>
</template>
