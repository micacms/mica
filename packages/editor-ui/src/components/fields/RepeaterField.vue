<script setup lang="ts">
/**
 * Repeating group of fields. The rows reorder as the entries of a collection
 * do (`useReorder`): a handle to drag or to move with the keyboard, and arrows.
 *
 * A row with rich text carries a key that names its `.mdoc` files (#220): a new
 * row gets one, and a copy gets a new one.
 */

import { computed, onMounted, ref, toRaw } from "vue";
import { ChevronDown, Copy, Plus, Trash2 } from "@lucide/vue";

import { defaultValues, needsRowKey, newRowKey, ROW_KEY, type RepeaterField } from "@micacms/core/internal";

import FieldList from "./FieldList.vue";
import ReorderArrows from "@/components/ReorderArrows.vue";
import ReorderHandle from "@/components/ReorderHandle.vue";
import { useField, type FieldProps } from "@/composables/useField";
import { useReorder } from "@/composables/useReorder";
import { entryOptions } from "@/lib/entry-options";
import { rowLabel, rowLabelRelation } from "@/lib/row-label";
import { useSchema } from "@/stores/schema";

const props = defineProps<
  FieldProps & { modelValue: unknown; collection?: string; entrySlug?: string }
>();
const emit = defineEmits<{ "update:modelValue": [Record<string, unknown>[]] }>();

const field = computed(() => props.field as RepeaterField);
const { label, error, locked } = useField(props);

/** The ids of the collapsed rows. */
const collapsed = ref(new Set<string>());

const rows = computed<Record<string, unknown>[]>(() =>
  Array.isArray(props.modelValue) ? (props.modelValue as Record<string, unknown>[]) : [],
);

/*
 * A row's id in this form: its key when it has one, else an id of the row object
 * that an edit passes on to the row's next object. Moving a row keeps its id, so
 * its inputs and its rich-text editor move with it. By the raw object: the rows
 * arrive as reactive proxies, and an edit emits a plain object.
 */
const ids = new WeakMap<object, string>();
let lastId = 0;
function rowId(row: Record<string, unknown>): string {
  const key = row[ROW_KEY];
  if (typeof key === "string" && key !== "") return key;
  const raw = toRaw(row);
  let id = ids.get(raw);
  if (!id) {
    id = `row-${++lastId}`;
    ids.set(raw, id);
  }
  return id;
}

const keyed = computed(() => needsRowKey(field.value.fields));

/** A row as it is added: a new key first when its fields hold rich text. */
function withKey(row: Record<string, unknown>): Record<string, unknown> {
  if (!keyed.value) return row;
  const taken = new Set(rows.value.map((item) => item[ROW_KEY]).filter((key): key is string => typeof key === "string"));
  const { [ROW_KEY]: _old, ...rest } = row;
  return { [ROW_KEY]: newRowKey(taken), ...rest };
}

const atMax = computed(() => field.value.max !== undefined && rows.value.length >= field.value.max);
const atMin = computed(() => field.value.min !== undefined && rows.value.length <= field.value.min);

/** The titles of the entries that an `itemLabel` relation names, so that a row shows "Tätsch", not "taetsch". */
const titles = ref(new Map<string, string>());
const schema = useSchema();

onMounted(async () => {
  const target = rowLabelRelation(field.value);
  if (!target) return;
  try {
    const options = await entryOptions(target, schema.reference(target) !== undefined);
    titles.value = new Map(options.map((option) => [option.slug, option.title]));
  } catch {
    // The rows show the slugs; the relation field in the row says that the list did not load.
  }
});

/** Row summary: the declared `itemLabel` child, else a positional fallback. */
function summaryFor(row: Record<string, unknown>, index: number): string {
  return rowLabel(field.value, row, index, (slug) => titles.value.get(slug));
}

function rowHasIssue(index: number): boolean {
  return props.issues?.some((issue) => issue.path.startsWith(`${props.path}.${index}.`)) ?? false;
}

function emitRows(next: Record<string, unknown>[]): void {
  emit("update:modelValue", next);
}

function add(): void {
  // A new row starts as a complete skeleton so every input is bound.
  emitRows([...rows.value, withKey(defaultValues(field.value.fields))]);
}

function duplicate(index: number): void {
  const source = rows.value[index];
  if (!source) return;
  const next = [...rows.value];
  // A JSON copy: a row is plain data, and `structuredClone` refuses Vue's proxies.
  next.splice(index + 1, 0, withKey(JSON.parse(JSON.stringify(source)) as Record<string, unknown>));
  emitRows(next);
}

function remove(index: number): void {
  const row = rows.value[index];
  emitRows(rows.value.filter((_, position) => position !== index));
  if (row) collapsed.value = new Set([...collapsed.value].filter((id) => id !== rowId(row)));
}

function updateRow(index: number, value: Record<string, unknown>): void {
  const row = rows.value[index];
  if (row) ids.set(toRaw(value), rowId(row));
  emitRows(rows.value.map((item, position) => (position === index ? value : item)));
}

/** A field in the row must take the focus (`focusField`): the row opens. */
function reveal(row: Record<string, unknown>): void {
  const id = rowId(row);
  if (collapsed.value.has(id)) collapsed.value = new Set([...collapsed.value].filter((other) => other !== id));
}

function toggle(row: Record<string, unknown>): void {
  const id = rowId(row);
  const next = new Set(collapsed.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  collapsed.value = next;
}

const reorder = useReorder<Record<string, unknown>>({
  scope: () => `rows-${props.path}`,
  items: () => rows.value,
  show: emitRows,
  // The form keeps the order: the next save writes it.
  commit: () => {},
  id: rowId,
  label: (row) => summaryFor(row, rows.value.indexOf(row)),
  disabled: () => locked.value,
});
</script>

<template>
  <fieldset>
    <legend class="field-label mb-1.5">
      {{ label }}
      <span v-if="field.required" class="text-danger" aria-hidden="true">*</span>
    </legend>

    <p v-if="field.description" class="field-hint -mt-1 mb-2">{{ field.description }}</p>

    <p :id="`${path}-order-help`" class="sr-only">
      To move an item with the keyboard, press Space on its handle, then the arrow keys, Home or End, and Space again
      to drop it. Escape puts it back. The arrows at the end of the row move it one step.
    </p>

    <ol v-if="rows.length" class="space-y-2">
      <li
        v-for="(row, index) in rows"
        :key="rowId(row)"
        :class="['card', reorder.isMoving(row) && 'ring-2 ring-accent']"
        v-bind="reorder.row(row)"
        @reveal-field="reveal(row)"
      >
        <!-- Rounded itself: the row does not clip, so that a list in a field can open over it (#350). -->
        <div
          :class="[
            'flex items-center gap-1 rounded-t-md bg-canvas/60 py-2 pr-2 pl-1',
            collapsed.has(rowId(row)) && 'rounded-b-md',
          ]"
        >
          <ReorderHandle
            :label="summaryFor(row, index)"
            :described-by="`${path}-order-help`"
            :disabled="locked"
            v-bind="reorder.handle(row)"
          />
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 text-left"
            :aria-expanded="!collapsed.has(rowId(row))"
            @click="toggle(row)"
          >
            <ChevronDown
              :size="16"
              :class="[
                'h-4 w-4 shrink-0 text-muted transition',
                !collapsed.has(rowId(row)) && 'rotate-180',
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
              :disabled="locked || atMax"
              @click="duplicate(index)"
            >
              <Copy :size="16" aria-hidden="true" />
              <span class="sr-only">Duplicate "{{ summaryFor(row, index) }}"</span>
            </button>

            <button
              type="button"
              class="btn-ghost px-1.5 py-1 hover:text-danger"
              :disabled="locked || atMin"
              @click="remove(index)"
            >
              <Trash2 :size="16" aria-hidden="true" />
              <span class="sr-only">Remove "{{ summaryFor(row, index) }}"</span>
            </button>

            <ReorderArrows
              :label="summaryFor(row, index)"
              :target="reorder.target(row)"
              :first="index === 0"
              :last="index === rows.length - 1"
              :disabled="locked"
              @move="reorder.step(row, $event)"
            />
          </div>
        </div>

        <div v-show="!collapsed.has(rowId(row))" class="border-t border-line p-4">
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
      :disabled="locked || atMax"
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
