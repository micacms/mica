<script setup lang="ts">
/**
 * Dispatches one field descriptor to its control.
 */

import { computed } from "vue";

import type { AnyField, FieldIssue } from "@micacms/core/internal";

import type { PageAddress } from "@/lib/pages";

import { fieldComponents } from "./registry";

const props = defineProps<{
  field: AnyField;
  path: string;
  modelValue: unknown;
  issues?: FieldIssue[];
  disabled?: boolean;
  /** Collection name and current ID, needed by ID generation. */
  collection?: string;
  entryId?: string;
  /** Value of the sibling an ID field derives from. */
  source?: string | null;
  sourceLabel?: string;
  /** The page's address around an ID field. */
  address?: PageAddress | null;
}>();

const emit = defineEmits<{ "update:modelValue": [unknown] }>();

const component = computed(() => fieldComponents[props.field.kind]);

// Only the ID control takes these; passing them everywhere would land them
// in the DOM as stray attributes.
const extra = computed(() =>
  props.field.kind === "id"
    ? { source: props.source, sourceLabel: props.sourceLabel, collection: props.collection, exceptId: props.entryId, address: props.address }
    : {},
);
</script>

<template>
  <p
    v-if="!component && !field.hidden"
    class="rounded-md border border-line bg-subtle px-3 py-2 text-xs text-muted"
  >
    {{ field.label ?? path }}: the field type "{{ field.kind }}" needs a newer version of Mica.
  </p>
  <component
    :is="component"
    v-else-if="!field.hidden"
    :field="field"
    :path="path"
    :issues="issues"
    :disabled="disabled"
    :model-value="modelValue"
    v-bind="extra"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
