<script setup lang="ts">
/**
 * Renders a field map as a form.
 *
 * Fields declaring the same `group` are boxed together with a heading; the rest
 * flow in declaration order. Widths come from the model (`full` / `half` /
 * `third`) over a twelve-column grid.
 */

import { computed } from "vue";

import type { AnyField, FieldIssue, FieldMap } from "@micacms/core/internal";

import FieldRenderer from "./FieldRenderer.vue";
import { humanise, widthClass } from "@/composables/useField";
import { slugAddress, type SlugAddress } from "@/lib/pages";
import { useSchema } from "@/stores/schema";

const props = defineProps<{
  fields: FieldMap;
  modelValue: Record<string, unknown>;
  /** Prefix for child paths; empty at the top level. */
  path?: string;
  issues?: FieldIssue[];
  disabled?: boolean;
  collection?: string;
  entrySlug?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [Record<string, unknown>] }>();

interface Entry {
  key: string;
  field: AnyField;
}

interface Group {
  name: string | null;
  entries: Entry[];
}

const groups = computed<Group[]>(() => {
  const result: Group[] = [];

  for (const [key, field] of Object.entries(props.fields)) {
    if (field.hidden) continue;

    const name = field.group ?? null;
    const last = result.at(-1);

    // Consecutive fields sharing a group name form one box; a different group
    // (or none) starts a new one, so declaration order is preserved.
    if (last && last.name === name) last.entries.push({ key, field });
    else result.push({ name, entries: [{ key, field }] });
  }

  return result;
});

const childPath = (key: string): string => (props.path ? `${props.path}.${key}` : key);

function update(key: string, value: unknown): void {
  emit("update:modelValue", { ...props.modelValue, [key]: value });
}

/** A slug field's hint names the sibling it follows by its label. */
function sourceLabelFor(field: AnyField): string | undefined {
  if (field.kind !== "slug" || !field.from) return undefined;
  return props.fields[field.from]?.label ?? humanise(field.from);
}

const schema = useSchema();

/** The entry's slug field shows the page's address around it, from the collection's `url`. Not a slug in an object or a row. */
function addressFor(field: AnyField): SlugAddress | null {
  if (field.kind !== "slug" || props.path || !props.collection) return null;
  const url = schema.collection(props.collection)?.url;
  return url ? slugAddress(url, props.modelValue, (name) => props.fields[name]?.label ?? humanise(name)) : null;
}

/** Slug fields follow a sibling; hand them its current value. */
function sourceFor(field: AnyField): string | null {
  if (field.kind !== "slug" || !field.from) return null;
  const value = props.modelValue[field.from];
  return typeof value === "string" ? value : null;
}
</script>

<template>
  <div class="space-y-6">
    <template v-for="(group, index) in groups" :key="`${group.name ?? 'ungrouped'}-${index}`">
      <fieldset v-if="group.name" class="card p-4 sm:p-5">
        <legend class="px-1 font-mono text-[11px] font-medium uppercase tracking-[.08em] text-muted">
          {{ group.name }}
        </legend>

        <div class="mt-3 grid grid-cols-12 gap-x-4 gap-y-5">
          <div v-for="entry in group.entries" :key="entry.key" :class="widthClass(entry.field)" :data-field-path="childPath(entry.key)">
            <FieldRenderer
              :field="entry.field"
              :path="childPath(entry.key)"
              :model-value="modelValue[entry.key]"
              :issues="issues"
              :disabled="disabled"
              :collection="collection"
              :entry-slug="entrySlug"
              :source="sourceFor(entry.field)"
              :source-label="sourceLabelFor(entry.field)"
              :address="addressFor(entry.field)"
              @update:model-value="update(entry.key, $event)"
            />
          </div>
        </div>
      </fieldset>

      <div v-else class="grid grid-cols-12 gap-x-4 gap-y-5">
        <div v-for="entry in group.entries" :key="entry.key" :class="widthClass(entry.field)" :data-field-path="childPath(entry.key)">
          <FieldRenderer
            :field="entry.field"
            :path="childPath(entry.key)"
            :model-value="modelValue[entry.key]"
            :issues="issues"
            :disabled="disabled"
            :collection="collection"
            :entry-slug="entrySlug"
            :source="sourceFor(entry.field)"
              :source-label="sourceLabelFor(entry.field)"
              :address="addressFor(entry.field)"
            @update:model-value="update(entry.key, $event)"
          />
        </div>
      </div>
    </template>
  </div>
</template>
