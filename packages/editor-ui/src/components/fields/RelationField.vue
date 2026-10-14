<script setup lang="ts">
/**
 * Relation field. Stores entry slugs, so a reference is readable both in the
 * JSON payload and in the diff a reviewer reads.
 *
 * The chosen entries come first, in their stored order. They change their order
 * as every list does (`useReorder`): a handle to drag or to move with the
 * keyboard, and arrows. Below them, a combobox (the ARIA combobox pattern) finds
 * an entry by its title or URL as the editor types.
 */

import { computed, nextTick, onMounted, ref } from "vue";

import type { RelationField } from "@micacms/core/internal";

import FieldShell from "./FieldShell.vue";
import type { EntrySummary } from "@/api";
import ReorderArrows from "@/components/ReorderArrows.vue";
import ReorderHandle from "@/components/ReorderHandle.vue";
import { useField, type FieldProps } from "@/composables/useField";
import { useReorder } from "@/composables/useReorder";
import { announce } from "@/lib/announce";
import { entryOptions } from "@/lib/entry-options";
import { matchEntries } from "@/lib/order";
import { useSchema } from "@/stores/schema";

const props = defineProps<FieldProps & { modelValue: unknown }>();
const emit = defineEmits<{ "update:modelValue": [string | string[] | null] }>();

const field = computed(() => props.field as RelationField);
const { inputId, label, error, describedBy, hintId, errorId, locked } = useField(props);
const schema = useSchema();

const options = ref<EntrySummary[]>([]);
const loading = ref(true);
const failed = ref(false);

const target = computed(() => schema.collection(field.value.collection));
const targetLabel = computed(() => target.value?.label ?? field.value.collection);
const singular = computed(() => (target.value?.labelSingular ?? "entry").toLowerCase());

onMounted(async () => {
  try {
    options.value = await entryOptions(field.value.collection);
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
});

const selected = computed<string[]>(() =>
  field.value.multiple
    ? Array.isArray(props.modelValue)
      ? (props.modelValue as string[])
      : []
    : typeof props.modelValue === "string"
      ? [props.modelValue]
      : [],
);

const titleFor = (slug: string): string => options.value.find((item) => item.slug === slug)?.title ?? slug;

const isMissing = (slug: string): boolean => !loading.value && !failed.value && !options.value.some((item) => item.slug === slug);

function store(slugs: string[]): void {
  emit("update:modelValue", field.value.multiple ? slugs : (slugs[0] ?? null));
}

const input = ref<HTMLInputElement | null>(null);

const reorder = useReorder<string>({
  scope: () => `relation-${props.path}`,
  items: () => selected.value,
  show: store,
  // The form keeps the order: the next save writes it.
  commit: () => {},
  id: (slug) => slug,
  label: titleFor,
  disabled: () => locked.value,
});

async function remove(slug: string): Promise<void> {
  if (locked.value) return;
  store(selected.value.filter((item) => item !== slug));
  announce(`Removed "${titleFor(slug)}".`);
  await nextTick();
  input.value?.focus();
}

/* The combobox. */

const listboxId = `${inputId}-listbox`;
const optionId = (index: number) => `${inputId}-option-${index}`;
const query = ref("");
const open = ref(false);
const active = ref(-1);

const results = computed(() => matchEntries(options.value, query.value, selected.value));

function show(): void {
  if (locked.value) return;
  open.value = true;
  active.value = -1;
}

function choose(entry: EntrySummary): void {
  store(field.value.multiple ? [...selected.value, entry.slug] : [entry.slug]);
  query.value = "";
  open.value = false;
  active.value = -1;
}

function onKeydown(event: KeyboardEvent): void {
  if (locked.value) return;
  const last = results.value.length - 1;
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      if (!open.value) show();
      active.value = Math.min(active.value + 1, last);
      break;
    case "ArrowUp":
      event.preventDefault();
      if (!open.value) show();
      active.value = active.value <= 0 ? last : active.value - 1;
      break;
    case "Enter": {
      const entry = open.value ? results.value[active.value] : undefined;
      if (!entry) return;
      event.preventDefault();
      choose(entry);
      break;
    }
    case "Escape":
      if (open.value) {
        event.preventDefault();
        open.value = false;
      } else {
        query.value = "";
      }
      break;
  }
}

function onInput(event: Event): void {
  if (locked.value) return;
  query.value = (event.target as HTMLInputElement).value;
  open.value = true;
  active.value = results.value.length > 0 ? 0 : -1;
}
</script>

<template>
  <FieldShell
    :input-id="inputId"
    :label="label"
    :description="field.description"
    :required="field.required"
    :error="error"
    :hint-id="hintId"
    :error-id="errorId"
  >
    <p v-if="loading" role="status" class="text-sm text-muted">Loading {{ targetLabel }}…</p>
    <p v-else-if="failed" role="alert" class="text-sm text-danger">
      Mica could not load {{ targetLabel }}. Load the page again to choose.
    </p>

    <template v-else>
      <p v-if="field.multiple" :id="`${inputId}-order-help`" class="sr-only">
        To move an entry with the keyboard, press Space on its handle, then the arrow keys, Home or End, and Space again
        to drop it. Escape puts it back. The arrows at the end of the row move it one step.
      </p>
      <ol
        v-if="selected.length > 0"
        class="mb-2 divide-y divide-line rounded-sm border border-line bg-raised"
        :aria-label="`Chosen ${targetLabel.toLowerCase()}`"
      >
        <li
          v-for="(slug, index) in selected"
          :key="slug"
          :class="['flex items-center gap-2 py-1.5 pr-1.5 text-sm', field.multiple ? 'pl-1' : 'pl-3', reorder.isMoving(slug) && 'bg-accent-soft']"
          v-bind="field.multiple ? reorder.row(slug) : {}"
        >
          <ReorderHandle
            v-if="field.multiple"
            :label="titleFor(slug)"
            :described-by="`${inputId}-order-help`"
            :disabled="locked"
            v-bind="reorder.handle(slug)"
          />
          <span class="min-w-0 flex-1 truncate">{{ titleFor(slug) }}</span>
          <span class="shrink-0 font-mono text-[11px] text-muted">{{ slug }}</span>
          <button
            type="button"
            class="btn-ghost px-1.5 py-0.5 text-xs aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
            :aria-disabled="locked || undefined"
            @click="remove(slug)"
          >
            Remove<span class="sr-only"> "{{ titleFor(slug) }}"</span>
          </button>
          <ReorderArrows
            v-if="field.multiple"
            :label="titleFor(slug)"
            :target="reorder.target(slug)"
            :first="index === 0"
            :last="index === selected.length - 1"
            :disabled="locked"
            @move="reorder.step(slug, $event)"
          />
        </li>
      </ol>

      <div class="relative">
        <input
          :id="inputId"
          ref="input"
          type="text"
          role="combobox"
          autocomplete="off"
          aria-autocomplete="list"
          :aria-expanded="open"
          :aria-controls="listboxId"
          :aria-activedescendant="open && active >= 0 ? optionId(active) : undefined"
          :aria-invalid="error ? 'true' : undefined"
          :aria-describedby="describedBy"
          :value="query"
          :placeholder="
            options.length === 0
              ? `There are no ${targetLabel.toLowerCase()} yet`
              : locked
                ? selected.length === 0 ? 'Not set' : ''
                : field.multiple || selected.length === 0
                  ? `Find a ${singular} to add…`
                  : `Find another ${singular}…`
          "
          :readonly="locked || options.length === 0"
          :class="['input', error && 'input-invalid']"
          @input="onInput"
          @focus="show"
          @blur="open = false"
          @keydown="onKeydown"
        />

        <ul
          v-show="open && results.length > 0"
          :id="listboxId"
          role="listbox"
          :aria-label="targetLabel"
          class="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-line bg-raised py-1 shadow-lg"
        >
          <li
            v-for="(entry, index) in results"
            :id="optionId(index)"
            :key="entry.slug"
            role="option"
            :aria-selected="index === active"
            :class="[
              'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm',
              index === active ? 'bg-accent-soft' : 'hover:bg-canvas',
            ]"
            @mousedown.prevent="choose(entry)"
          >
            <span class="min-w-0 flex-1 truncate">{{ entry.title }}</span>
            <span class="shrink-0 font-mono text-[11px] text-muted">{{ entry.slug }}</span>
          </li>
        </ul>
        <p class="sr-only" role="status">
          {{ open && query ? `${results.length === 0 ? "No" : results.length} matching ${results.length === 1 ? singular : targetLabel.toLowerCase()}` : "" }}
        </p>
      </div>
    </template>

    <!-- A reference whose target was deleted or renamed would silently vanish
         from the frontend; say so instead. -->
    <p v-for="slug in selected.filter(isMissing)" :key="slug" class="field-error">
      "{{ titleFor(slug) }}" is no longer in {{ targetLabel }}.
    </p>
  </FieldShell>
</template>
