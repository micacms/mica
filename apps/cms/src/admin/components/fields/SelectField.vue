<script setup lang="ts">
import { computed } from "vue";

import type { SelectField } from "@micacms/model";

import FieldShell from "./FieldShell.vue";
import { useField, type FieldProps } from "@/composables/useField";

const props = defineProps<FieldProps & { modelValue: unknown }>();
const emit = defineEmits<{ "update:modelValue": [string | string[] | null] }>();

const field = computed(() => props.field as SelectField);
const { inputId, label, error, describedBy, hintId, errorId } = useField(props);

const selected = computed<string[]>(() =>
  Array.isArray(props.modelValue)
    ? (props.modelValue as string[])
    : typeof props.modelValue === "string"
      ? [props.modelValue]
      : [],
);

function toggle(value: string): void {
  const next = selected.value.includes(value)
    ? selected.value.filter((item) => item !== value)
    : [...selected.value, value];
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
    <!-- Multi-select is a checkbox group: a native multiple <select> is
         notoriously hard to operate, especially on a tablet. -->
    <fieldset v-if="field.multiple" class="space-y-1.5" :aria-describedby="describedBy">
      <legend class="sr-only">{{ label }}</legend>
      <label
        v-for="option in field.options"
        :key="option.value"
        class="flex cursor-pointer items-center gap-2.5 rounded-lg border border-line bg-white px-3 py-2 text-sm hover:bg-canvas"
      >
        <input
          type="checkbox"
          :checked="selected.includes(option.value)"
          :disabled="disabled || field.readonly"
          class="h-4 w-4 rounded border-line text-brand focus:ring-brand/25"
          @change="toggle(option.value)"
        />
        {{ option.label }}
      </label>
    </fieldset>

    <select
      v-else
      :id="inputId"
      :value="selected[0] ?? ''"
      :required="field.required"
      :disabled="disabled || field.readonly"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="describedBy"
      :class="['input', error && 'input-invalid']"
      @change="
        emit('update:modelValue', ($event.target as HTMLSelectElement).value || null)
      "
    >
      <option value="">{{ field.required ? "Choose…" : "Not set" }}</option>
      <option v-for="option in field.options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
  </FieldShell>
</template>
