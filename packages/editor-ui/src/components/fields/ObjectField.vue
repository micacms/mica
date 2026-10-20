<script setup lang="ts">
/**
 * Nested object. Recurses through `FieldList`, so nesting depth is unbounded.
 */

import { computed, ref } from "vue";
import { ChevronDown } from "@lucide/vue";

import type { ObjectField } from "@micacms/core/internal";

import FieldList from "./FieldList.vue";
import { useField, type FieldProps } from "@/composables/useField";

const props = defineProps<
  FieldProps & { modelValue: unknown; collection?: string; entrySlug?: string }
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
</script>

<template>
  <!-- A field inside that must take the focus opens the group (`focusField`). -->
  <fieldset class="card overflow-hidden" @reveal-field="open = true">
    <legend class="sr-only">{{ label }}</legend>

    <component
      :is="field.collapsible ? 'button' : 'div'"
      :type="field.collapsible ? 'button' : undefined"
      :aria-expanded="field.collapsible ? expanded : undefined"
      :class="[
        'flex w-full items-center gap-2 px-4 py-3 text-left',
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
        :entry-slug="entrySlug"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </div>

    <p v-if="error" class="px-4 pb-3 text-xs font-medium text-danger">{{ error }}</p>
  </fieldset>
</template>
