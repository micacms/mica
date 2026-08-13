<script setup lang="ts">
/** Label, description and error message around any control. */

defineProps<{
  inputId: string;
  label: string;
  description?: string | null;
  required?: boolean;
  error?: string | null;
  hintId: string;
  errorId: string;
  /** Repeaters and objects supply their own heading. */
  bare?: boolean;
}>();
</script>

<template>
  <div>
    <label v-if="!bare" :for="inputId" class="field-label">
      {{ label }}
      <span v-if="required" class="text-danger" aria-hidden="true">*</span>
      <span v-if="required" class="sr-only">(required)</span>
    </label>

    <div :class="bare ? '' : 'mt-1.5'">
      <slot />
    </div>

    <p v-if="description" :id="hintId" class="field-hint">{{ description }}</p>
    <p v-if="error" :id="errorId" class="field-error">{{ error }}</p>
  </div>
</template>
