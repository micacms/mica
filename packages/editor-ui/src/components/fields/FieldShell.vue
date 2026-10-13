<script setup lang="ts">
/**
 * Label, description and error message around any control.
 *
 * `as` says what the label names: one form control (`label`), a group of
 * controls (`group`, a fieldset with a legend), or a control that is not a form
 * element and names itself with `aria-labelledby` (`text`).
 */

withDefaults(
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
    as?: "label" | "group" | "text";
    /** For a group: the hint and the error, which its controls cannot all carry. */
    describedBy?: string;
  }>(),
  { as: "label", description: null, error: null, describedBy: undefined },
);
</script>

<template>
  <fieldset v-if="as === 'group' && !bare" :aria-describedby="describedBy">
    <legend class="field-label">
      {{ label }}
      <span v-if="required" class="text-danger" aria-hidden="true">*</span>
      <span v-if="required" class="sr-only">(required)</span>
    </legend>

    <div class="mt-1.5">
      <slot />
    </div>

    <p v-if="description" :id="hintId" class="field-hint">{{ description }}</p>
    <p v-if="error" :id="errorId" class="field-error">{{ error }}</p>
  </fieldset>

  <div v-else>
    <template v-if="!bare">
      <label v-if="as === 'label'" :for="inputId" class="field-label">
        {{ label }}
        <span v-if="required" class="text-danger" aria-hidden="true">*</span>
        <span v-if="required" class="sr-only">(required)</span>
      </label>
      <p v-else :id="`${inputId}-label`" class="field-label">
        {{ label }}
        <span v-if="required" class="text-danger" aria-hidden="true">*</span>
        <span v-if="required" class="sr-only">(required)</span>
      </p>
    </template>

    <div :class="bare ? '' : 'mt-1.5'">
      <slot />
    </div>

    <p v-if="description" :id="hintId" class="field-hint">{{ description }}</p>
    <p v-if="error" :id="errorId" class="field-error">{{ error }}</p>
  </div>
</template>
