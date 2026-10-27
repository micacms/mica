<script setup lang="ts">
/**
 * Nested object. Recurses through `FieldList`, so nesting depth is unbounded. A localized field is an object with one
 * field for each locale: in a form with a language, it shows the input of that language only, with the button of its
 * other languages beside the label, and the language's fallback as the placeholder of an empty text.
 */

import { computed, nextTick, ref } from "vue";
import { ChevronDown } from "@lucide/vue";

import { isLocalizedObject, type AnyField, type ObjectField } from "@micacms/core/internal";

import FieldList from "./FieldList.vue";
import FieldRenderer from "./FieldRenderer.vue";
import MissingTranslations from "./MissingTranslations.vue";
import { useField, type FieldProps } from "@/composables/useField";
import { provideFieldTranslations, useFormLocale } from "@/composables/useFormLocale";
import { fallbackFor, missingTranslations } from "@/lib/locales";

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

/** For a group in a form with a language: the values inside that this language has not translated yet. */
const missingInside = computed(() =>
  form.value && !locale.value ? missingTranslations(field.value.fields, value.value, form.value.locale.value, form.value.locales) : 0,
);

const PLACEHOLDER_KINDS = new Set(["text", "textarea", "email", "url"]);

/**
 * The field of the shown locale, with the label and the description of the whole field: the language is in the page
 * header. The fallback is its placeholder.
 */
const shown = computed<AnyField | null>(() => {
  const own = locale.value ? field.value.fields[locale.value] : undefined;
  if (!own) return null;
  const placeholder = fallback.value && PLACEHOLDER_KINDS.has(own.kind) ? { placeholder: String(fallback.value.value) } : {};
  return {
    ...own,
    label: label.value,
    ...(field.value.description ? { description: field.value.description } : {}),
    ...placeholder,
    ...(field.value.readonly ? { readonly: true } : {}),
  } as AnyField;
});

const container = ref<HTMLElement | null>(null);

/** Another language's value as the start of this one's: a copy, and the focus in the input to change it. */
async function use(from: string): Promise<void> {
  if (!locale.value) return;
  const copy: unknown = JSON.parse(JSON.stringify(value.value[from] ?? null));
  emit("update:modelValue", { ...value.value, [locale.value]: copy });
  await nextTick();
  container.value?.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, [contenteditable="true"]')?.focus();
}

// Also null, for a group that is not localized: the translations stop at the field that they belong to.
provideFieldTranslations(
  computed(() =>
    locale.value && form.value
      ? {
          field: field.value,
          value: value.value,
          locale: locale.value,
          locales: form.value.locales,
          label: label.value,
          locked: !!props.disabled || !!field.value.readonly,
          use,
        }
      : null,
  ),
);
</script>

<template>
  <div v-if="shown && locale" ref="container" :data-field-path="`${path}.${locale}`">
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
      <MissingTranslations v-if="missingInside" :count="missingInside" />

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
