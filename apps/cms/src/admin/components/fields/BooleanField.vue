<script setup lang="ts">
import { computed } from "vue";

import type { BooleanField } from "@micacms/model";

import { useField, type FieldProps } from "@/composables/useField";

const props = defineProps<FieldProps & { modelValue: unknown }>();
const emit = defineEmits<{ "update:modelValue": [boolean] }>();

const field = computed(() => props.field as BooleanField);
const { inputId, label, error, describedBy, hintId, errorId } = useField(props);

const checked = computed(() => props.modelValue === true);
</script>

<template>
  <div>
    <!-- A real checkbox: it is keyboard-operable and announced correctly
         without any ARIA work of our own. -->
    <label
      :for="inputId"
      class="flex cursor-pointer items-start gap-3 rounded-sm border border-line bg-raised p-3 transition hover:bg-canvas has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
    >
      <input
        :id="inputId"
        type="checkbox"
        :checked="checked"
        :disabled="disabled || field.readonly"
        :aria-describedby="describedBy"
        class="mt-0.5 h-4 w-4 shrink-0 rounded-sm border-line text-brand focus:ring-ink/20"
        @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
      />
      <span class="min-w-0">
        <span class="block text-sm font-medium">{{ label }}</span>
        <span v-if="field.description" :id="hintId" class="block text-xs text-muted">
          {{ field.description }}
        </span>
      </span>
    </label>

    <p v-if="error" :id="errorId" class="field-error">{{ error }}</p>
  </div>
</template>
