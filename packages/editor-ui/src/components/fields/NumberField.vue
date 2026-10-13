<script setup lang="ts">
import { computed } from "vue";

import type { NumberField } from "@micacms/core";

import FieldShell from "./FieldShell.vue";
import { useField, type FieldProps } from "@/composables/useField";

const props = defineProps<FieldProps & { modelValue: unknown }>();
const emit = defineEmits<{ "update:modelValue": [number | null] }>();

const field = computed(() => props.field as NumberField);
const { inputId, label, error, describedBy, hintId, errorId, locked } = useField(props);

const value = computed(() => (typeof props.modelValue === "number" ? String(props.modelValue) : ""));

function onInput(event: Event): void {
  const raw = (event.target as HTMLInputElement).value;
  if (raw.trim() === "") {
    emit("update:modelValue", null);
    return;
  }

  const parsed = Number(raw);
  // A half-typed value like "-" parses as NaN; keep the field empty rather than
  // emitting something the schema will reject on every keystroke.
  emit("update:modelValue", Number.isFinite(parsed) ? parsed : null);
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
    <div class="relative">
      <input
        :id="inputId"
        type="number"
        inputmode="decimal"
        :value="value"
        :min="field.min"
        :max="field.max"
        :step="field.step ?? (field.integer ? 1 : 'any')"
        :required="field.required"
        :readonly="locked"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        :class="['input', field.unit && 'pr-12', error && 'input-invalid']"
        @input="onInput"
      />
      <span
        v-if="field.unit"
        class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted"
      >
        {{ field.unit }}
      </span>
    </div>
  </FieldShell>
</template>
