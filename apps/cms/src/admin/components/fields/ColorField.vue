<script setup lang="ts">
import { computed } from "vue";

import type { ColorField } from "@micacms/model";

import FieldShell from "./FieldShell.vue";
import { useField, type FieldProps } from "@/composables/useField";

const props = defineProps<FieldProps & { modelValue: unknown }>();
const emit = defineEmits<{ "update:modelValue": [string | null] }>();

const field = computed(() => props.field as ColorField);
const { inputId, label, error, describedBy, hintId, errorId } = useField(props);

const value = computed(() => (typeof props.modelValue === "string" ? props.modelValue : ""));

// <input type="color"> only accepts #rrggbb, so it needs a concrete fallback.
const swatchValue = computed(() => (/^#[0-9a-f]{6}$/i.test(value.value) ? value.value : "#000000"));

function emitValue(next: string): void {
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
    <div class="flex items-center gap-2">
      <input
        type="color"
        :value="swatchValue"
        :disabled="disabled || field.readonly"
        :aria-label="`${label} colour picker`"
        class="h-9.5 w-12 shrink-0 cursor-pointer rounded-lg border border-line bg-white p-1"
        @input="emitValue(($event.target as HTMLInputElement).value)"
      />
      <input
        :id="inputId"
        type="text"
        :value="value"
        placeholder="#1a2b3c"
        spellcheck="false"
        :disabled="disabled || field.readonly"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        :class="['input font-mono text-[13px] uppercase', error && 'input-invalid']"
        @input="emitValue(($event.target as HTMLInputElement).value.trim())"
      />
    </div>

    <div v-if="field.presets?.length" class="mt-2 flex flex-wrap gap-1.5">
      <button
        v-for="preset in field.presets"
        :key="preset"
        type="button"
        :title="preset"
        :disabled="disabled || field.readonly"
        :aria-pressed="value.toLowerCase() === preset.toLowerCase()"
        :class="[
          'h-7 w-7 rounded-full border transition',
          value.toLowerCase() === preset.toLowerCase()
            ? 'border-ink ring-2 ring-ink/15'
            : 'border-line hover:scale-110',
        ]"
        :style="{ backgroundColor: preset }"
        @click="emitValue(preset)"
      >
        <span class="sr-only">Use {{ preset }}</span>
      </button>
    </div>
  </FieldShell>
</template>
