<script setup lang="ts">
import { computed } from "vue";

import type { SelectField } from "@micacms/core";

import FieldShell from "./FieldShell.vue";
import { useField, type FieldProps } from "@/composables/useField";

const props = defineProps<FieldProps & { modelValue: unknown }>();
const emit = defineEmits<{ "update:modelValue": [string | string[] | null] }>();

const field = computed(() => props.field as SelectField);
const { inputId, label, error, describedBy, hintId, errorId, locked } = useField(props);

const selected = computed<string[]>(() =>
  Array.isArray(props.modelValue)
    ? (props.modelValue as string[])
    : typeof props.modelValue === "string"
      ? [props.modelValue]
      : [],
);

/** A native select has no read-only state: while locked, it puts the stored choice back. */
function onSelect(event: Event): void {
  const select = event.target as HTMLSelectElement;
  if (locked.value) {
    select.value = selected.value[0] ?? "";
    return;
  }
  emit("update:modelValue", select.value || null);
}

function toggle(value: string): void {
  const next = selected.value.includes(value)
    ? selected.value.filter((item) => item !== value)
    : [...selected.value, value];
  emit("update:modelValue", next);
}
</script>

<template>
  <FieldShell
    :as="field.multiple ? 'group' : 'label'"
    :input-id="inputId"
    :label="label"
    :description="field.description"
    :required="field.required"
    :error="error"
    :hint-id="hintId"
    :error-id="errorId"
    :described-by="describedBy"
  >
    <!-- Multi-select is a checkbox group: a native multiple <select> is
         notoriously hard to operate, especially on a tablet. -->
    <div v-if="field.multiple" class="space-y-1.5">
      <label
        v-for="option in field.options"
        :key="option.value"
        :class="[
          'flex items-center gap-2.5 rounded-sm border border-line px-3 py-2 text-sm',
          locked ? 'cursor-default bg-subtle' : 'cursor-pointer bg-raised hover:bg-canvas',
        ]"
      >
        <input
          type="checkbox"
          :checked="selected.includes(option.value)"
          :aria-readonly="locked || undefined"
          class="h-4 w-4 rounded-sm border-line text-accent focus:ring-ink/20"
          @click="locked && $event.preventDefault()"
          @change="toggle(option.value)"
        />
        {{ option.label }}
      </label>
    </div>

    <select
      v-else
      :id="inputId"
      :value="selected[0] ?? ''"
      :required="field.required"
      :aria-readonly="locked || undefined"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="describedBy"
      :class="['input', error && 'input-invalid', locked && 'bg-subtle text-muted']"
      @change="onSelect"
    >
      <option value="">{{ field.required ? "Choose…" : "Not set" }}</option>
      <option v-for="option in field.options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
  </FieldShell>
</template>
