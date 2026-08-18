<script setup lang="ts">
/**
 * Repeating group of fields.
 *
 * Reordering is done with buttons rather than drag-and-drop: it works with a
 * keyboard, on a tablet, and with a screen reader, none of which are true of a
 * drag handle without a great deal more code.
 */

import { computed, ref } from "vue";
import { ArrowDown, ArrowUp, ChevronDown, Copy, Plus, Trash2 } from "@lucide/vue";

import { defaultValues, type RepeaterField } from "@micacms/model";

import FieldList from "./FieldList.vue";
import { humanise, useField, type FieldProps } from "@/composables/useField";

const props = defineProps<
  FieldProps & { modelValue: unknown; collection?: string; entrySlug?: string }
>();
const emit = defineEmits<{ "update:modelValue": [Record<string, unknown>[]] }>();

const field = computed(() => props.field as RepeaterField);
const { label, error } = useField(props);

const collapsed = ref(new Set<number>());

const rows = computed<Record<string, unknown>[]>(() =>
  Array.isArray(props.modelValue) ? (props.modelValue as Record<string, unknown>[]) : [],
);

const atMax = computed(() => field.value.max !== undefined && rows.value.length >= field.value.max);
const atMin = computed(() => field.value.min !== undefined && rows.value.length <= field.value.min);

/** Row summary: the declared `itemLabel` child, else a positional fallback. */
function summaryFor(row: Record<string, unknown>, index: number): string {
  const key = field.value.itemLabel;
  const value = key ? row[key] : undefined;
  if (typeof value === "string" && value.trim()) return value.trim();
  return `${humanise(field.value.addLabel?.replace(/^Add\s+/i, "") ?? "Item")} ${index + 1}`;
}

function rowHasIssue(index: number): boolean {
  return props.issues?.some((issue) => issue.path.startsWith(`${props.path}.${index}.`)) ?? false;
}

function emitRows(next: Record<string, unknown>[]): void {
  emit("update:modelValue", next);
}

function add(): void {
  // A new row starts as a complete skeleton so every input is bound.
  emitRows([...rows.value, defaultValues(field.value.fields)]);
}

function duplicate(index: number): void {
  const source = rows.value[index];
  if (!source) return;
  const next = [...rows.value];
  next.splice(index + 1, 0, structuredClone(source));
  emitRows(next);
}

function remove(index: number): void {
  emitRows(rows.value.filter((_, position) => position !== index));
  collapsed.value = new Set(
    [...collapsed.value].filter((item) => item !== index).map((item) => (item > index ? item - 1 : item)),
  );
}

function move(index: number, direction: -1 | 1): void {
  const target = index + direction;
  if (target < 0 || target >= rows.value.length) return;

  const next = [...rows.value];
  [next[index], next[target]] = [next[target]!, next[index]!];
  emitRows(next);
}

function updateRow(index: number, value: Record<string, unknown>): void {
  emitRows(rows.value.map((row, position) => (position === index ? value : row)));
}

function toggle(index: number): void {
  const next = new Set(collapsed.value);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  collapsed.value = next;
}
</script>

<template>
  <fieldset>
    <legend class="field-label mb-1.5">
      {{ label }}
      <span v-if="field.required" class="text-danger" aria-hidden="true">*</span>
    </legend>

    <p v-if="field.description" class="field-hint -mt-1 mb-2">{{ field.description }}</p>

    <ol v-if="rows.length" class="space-y-2">
      <li v-for="(row, index) in rows" :key="index" class="card overflow-hidden">
        <div class="flex items-center gap-1 bg-canvas/60 px-3 py-2">
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 text-left"
            :aria-expanded="!collapsed.has(index)"
            @click="toggle(index)"
          >
            <ChevronDown
              :size="16"
              :class="[
                'h-4 w-4 shrink-0 text-muted transition',
                !collapsed.has(index) && 'rotate-180',
              ]"
              aria-hidden="true"
            />
            <span class="truncate text-sm font-medium">{{ summaryFor(row, index) }}</span>
            <span
              v-if="rowHasIssue(index)"
              class="badge shrink-0 bg-danger-soft text-danger"
            >
              Needs attention
            </span>
          </button>

          <div class="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              class="btn-ghost px-1.5 py-1"
              :disabled="disabled || index === 0"
              @click="move(index, -1)"
            >
              <ArrowUp :size="16" aria-hidden="true" />
              <span class="sr-only">Move "{{ summaryFor(row, index) }}" up</span>
            </button>

            <button
              type="button"
              class="btn-ghost px-1.5 py-1"
              :disabled="disabled || index === rows.length - 1"
              @click="move(index, 1)"
            >
              <ArrowDown :size="16" aria-hidden="true" />
              <span class="sr-only">Move "{{ summaryFor(row, index) }}" down</span>
            </button>

            <button
              type="button"
              class="btn-ghost px-1.5 py-1"
              :disabled="disabled || atMax"
              @click="duplicate(index)"
            >
              <Copy :size="16" aria-hidden="true" />
              <span class="sr-only">Duplicate "{{ summaryFor(row, index) }}"</span>
            </button>

            <button
              type="button"
              class="btn-ghost px-1.5 py-1 hover:text-danger"
              :disabled="disabled || atMin"
              @click="remove(index)"
            >
              <Trash2 :size="16" aria-hidden="true" />
              <span class="sr-only">Remove "{{ summaryFor(row, index) }}"</span>
            </button>
          </div>
        </div>

        <div v-show="!collapsed.has(index)" class="border-t border-line p-4">
          <FieldList
            :fields="field.fields"
            :model-value="row"
            :path="`${path}.${index}`"
            :issues="issues"
            :disabled="disabled || field.readonly"
            :collection="collection"
            :entry-slug="entrySlug"
            @update:model-value="updateRow(index, $event)"
          />
        </div>
      </li>
    </ol>

    <p v-else class="rounded-lg border border-dashed border-line px-4 py-5 text-center text-sm text-muted">
      Nothing added yet.
    </p>

    <button
      type="button"
      class="btn-secondary mt-2"
      :disabled="disabled || field.readonly || atMax"
      @click="add"
    >
      <Plus :size="16" aria-hidden="true" />
      {{ field.addLabel ?? "Add item" }}
    </button>

    <span v-if="atMax" class="ml-2 text-xs text-muted">
      Maximum of {{ field.max }} reached.
    </span>

    <p v-if="error" class="field-error">{{ error }}</p>
  </fieldset>
</template>
