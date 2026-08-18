<script setup lang="ts">
/**
 * Dispatches one field descriptor to its control.
 */

import { computed } from "vue";

import type { AnyField, FieldIssue } from "@micacms/model";

import { fieldComponents } from "./registry";

const props = defineProps<{
  field: AnyField;
  path: string;
  modelValue: unknown;
  issues?: FieldIssue[];
  disabled?: boolean;
  /** Collection name and current slug, needed by slug generation. */
  collection?: string;
  entrySlug?: string;
  /** Value of the sibling a slug field derives from. */
  source?: string | null;
}>();

const emit = defineEmits<{ "update:modelValue": [unknown] }>();

const component = computed(() => fieldComponents[props.field.kind]);

// Only the slug control takes these; passing them everywhere would land them
// in the DOM as stray attributes.
const extra = computed(() =>
  props.field.kind === "slug"
    ? { source: props.source, collection: props.collection, exceptSlug: props.entrySlug }
    : {},
);
</script>

<template>
  <component
    :is="component"
    v-if="!field.hidden"
    :field="field"
    :path="path"
    :issues="issues"
    :disabled="disabled"
    :model-value="modelValue"
    v-bind="extra"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
