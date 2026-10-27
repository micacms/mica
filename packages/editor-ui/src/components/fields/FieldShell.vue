<script setup lang="ts">
/**
 * Label, description and error message around any control.
 *
 * `as` says what the label names: one form control (`label`), a group of
 * controls (`group`, a fieldset with a legend), or a control that is not a form
 * element and names itself with `aria-labelledby` (`text`).
 *
 * The input of a localized field has the button of its translations at the end
 * of the label's line. The control of its value has the value's language
 * (`useField`), for the spelling check and a screen reader.
 */

import FieldTranslations from "./FieldTranslations.vue";
import { useFieldTranslations } from "@/composables/useFormLocale";

const translations = useFieldTranslations();

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
  <fieldset v-if="as === 'group' && !bare" :aria-describedby="describedBy" class="relative">
    <!-- The button is not in the legend, which names the group: it is at the end of the legend's line. -->
    <legend :class="['field-label', translations && 'pr-8']">
      {{ label }}
      <span v-if="required" class="text-danger" aria-hidden="true">*</span>
      <span v-if="required" class="sr-only">(required)</span>
    </legend>
    <div v-if="translations" class="absolute top-0 right-0">
      <FieldTranslations :translations="translations" />
    </div>

    <div class="mt-1.5">
      <slot />
    </div>

    <p v-if="description" :id="hintId" class="field-hint">{{ description }}</p>
    <p v-if="error" :id="errorId" class="field-error">{{ error }}</p>
  </fieldset>

  <div v-else>
    <div v-if="!bare" class="flex items-center justify-between gap-2">
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
      <FieldTranslations v-if="translations" :translations="translations" />
    </div>

    <div :class="bare ? '' : 'mt-1.5'">
      <slot />
    </div>

    <p v-if="description" :id="hintId" class="field-hint">{{ description }}</p>
    <p v-if="error" :id="errorId" class="field-error">{{ error }}</p>
  </div>
</template>
