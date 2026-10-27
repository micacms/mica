<script setup lang="ts">
/**
 * Label, description and error message around any control.
 *
 * `as` says what the label names: one form control (`label`), a group of
 * controls (`group`, a fieldset with a legend), or a control that is not a form
 * element and names itself with `aria-labelledby` (`text`).
 *
 * The input of a localized field has the button of its translations at the end
 * of the label's line, and the language of its value.
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
  <fieldset v-if="as === 'group' && !bare" :aria-describedby="describedBy">
    <legend class="field-label flex w-full items-center justify-between gap-2">
      <span>
        {{ label }}
        <span v-if="required" class="text-danger" aria-hidden="true">*</span>
        <span v-if="required" class="sr-only">(required)</span>
      </span>
      <FieldTranslations v-if="translations" :translations="translations" />
    </legend>

    <div class="mt-1.5" :lang="translations?.locale">
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

    <!-- The language of the value, for the spelling check and a screen reader. -->
    <div :class="bare ? '' : 'mt-1.5'" :lang="translations?.locale">
      <slot />
    </div>

    <p v-if="description" :id="hintId" class="field-hint">{{ description }}</p>
    <p v-if="error" :id="errorId" class="field-error">{{ error }}</p>
  </div>
</template>
