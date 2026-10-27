<script setup lang="ts">
/**
 * Nested object. Recurses through `FieldList`, so nesting depth is unbounded. A localized field is an object with one
 * field for each locale: in a form with a language, it shows the input of that language only.
 */

import { computed, ref } from "vue";
import { ChevronDown } from "@lucide/vue";

import { isLocalizedObject, type AnyField, type ObjectField } from "@micacms/core/internal";

import FieldList from "./FieldList.vue";
import FieldRenderer from "./FieldRenderer.vue";
import { useField, type FieldProps } from "@/composables/useField";
import { useFormLocale } from "@/composables/useFormLocale";
import { fallbackFor } from "@/lib/locales";
import { previewValue } from "@/lib/format";

const props = defineProps<
  FieldProps & { modelValue: unknown; collection?: string; entryId?: string }
>();
const emit = defineEmits<{ "update:modelValue": [Record<string, unknown>] }>();

const field = computed(() => props.field as ObjectField);
const { label, error } = useField(props);

const open = ref(!field.value.collapsed);

const value = computed<Record<string, unknown>>(() =>
  props.modelValue && typeof props.modelValue === "object"
    ? (props.modelValue as Record<string, unknown>)
    : {},
);

// A collapsed group that hides an error is a trap; force it open.
const hasIssueInside = computed(
  () => props.issues?.some((issue) => issue.path.startsWith(`${props.path}.`)) ?? false,
);

const expanded = computed(() => open.value || hasIssueInside.value);

const form = useFormLocale();

/** In a form with a language: the locale whose input a localized field shows. */
const locale = computed(() => (form.value && isLocalizedObject(field.value) ? form.value.locale.value : null));

/** What the website shows while this language is empty: the value of the next locale in its chain. */
const fallback = computed(() => {
  if (!locale.value || !form.value) return null;
  const own = value.value[locale.value];
  if (own !== null && own !== undefined && own !== "" && !(Array.isArray(own) && own.length === 0)) return null;
  return fallbackFor(field.value, value.value, locale.value, form.value.locales);
});

const PLACEHOLDER_KINDS = new Set(["text", "textarea", "email", "url"]);

/** The field of the shown locale, with the description of the whole field, and the fallback as its placeholder. */
const shown = computed<AnyField | null>(() => {
  const own = locale.value ? field.value.fields[locale.value] : undefined;
  if (!own) return null;
  const placeholder = fallback.value && PLACEHOLDER_KINDS.has(own.kind) ? { placeholder: String(fallback.value.value) } : {};
  return { ...own, ...(field.value.description ? { description: field.value.description } : {}), ...placeholder, ...(field.value.readonly ? { readonly: true } : {}) } as AnyField;
});

const fallbackHint = computed(() => {
  if (!fallback.value || !shown.value) return null;
  const from = fallback.value.locale.toUpperCase();
  return PLACEHOLDER_KINDS.has(shown.value.kind)
    ? `Empty: the website shows the ${from} text.`
    : `Empty: the website shows the ${from} value, ${previewValue(fallback.value.value, shown.value)}.`;
});
</script>

<template>
  <div v-if="shown && locale" :data-field-path="`${path}.${locale}`">
    <FieldRenderer
      :field="shown"
      :path="`${path}.${locale}`"
      :model-value="value[locale] ?? null"
      :issues="issues"
      :disabled="disabled"
      :collection="collection"
      :entry-id="entryId"
      @update:model-value="emit('update:modelValue', { ...value, [locale]: $event })"
    />
    <p v-if="fallbackHint" class="mt-1 text-xs text-muted">{{ fallbackHint }}</p>
  </div>

  <!-- A field inside that must take the focus opens the group (`focusField`). -->
  <!-- No clipping, so that a list in a field can open over the edge (#350). -->
  <fieldset v-else class="card" @reveal-field="open = true">
    <legend class="sr-only">{{ label }}</legend>

    <component
      :is="field.collapsible ? 'button' : 'div'"
      :type="field.collapsible ? 'button' : undefined"
      :aria-expanded="field.collapsible ? expanded : undefined"
      :class="[
        'flex w-full items-center gap-2 rounded-t-md px-4 py-3 text-left',
        !expanded && 'rounded-b-md',
        field.collapsible && 'hover:bg-canvas',
      ]"
      @click="field.collapsible ? (open = !expanded) : undefined"
    >
      <span class="text-sm font-semibold">{{ label }}</span>

      <span
        v-if="hasIssueInside"
        class="badge bg-danger-soft text-danger"
      >
        Needs attention
      </span>

      <ChevronDown
        v-if="field.collapsible"
        :size="16"
        :class="['ml-auto h-4 w-4 text-muted transition', expanded && 'rotate-180']"
        aria-hidden="true"
      />
    </component>

    <div v-show="expanded" class="border-t border-line p-4 sm:p-5">
      <p v-if="field.description" class="mb-4 text-xs text-muted">
        {{ field.description }}
      </p>

      <FieldList
        :fields="field.fields"
        :model-value="value"
        :path="path"
        :issues="issues"
        :disabled="disabled || field.readonly"
        :collection="collection"
        :entry-id="entryId"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </div>

    <p v-if="error" class="px-4 pb-3 text-xs font-medium text-danger">{{ error }}</p>
  </fieldset>
</template>
