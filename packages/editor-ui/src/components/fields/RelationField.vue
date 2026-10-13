<script setup lang="ts">
/**
 * Relation field. Stores entry slugs, so a reference is readable both in the
 * JSON payload and in the diff a reviewer reads.
 *
 * The chosen entries come first, in their stored order, with buttons to move
 * them. Below them, a combobox (the ARIA combobox pattern) finds an entry by
 * its title or URL as the editor types.
 */

import { computed, nextTick, onMounted, ref } from "vue";

import type { RelationField } from "@micacms/core";

import FieldShell from "./FieldShell.vue";
import type { EntrySummary } from "@/api";
import { useField, type FieldProps } from "@/composables/useField";
import { announce } from "@/lib/announce";
import { entryOptions } from "@/lib/entry-options";
import { matchEntries, moveItem } from "@/lib/order";
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
const list = ref<HTMLElement | null>(null);

/**
 * The row buttons use `aria-disabled`, not `disabled`: a button that becomes
 * disabled, or a row that Vue moves, would drop the keyboard focus.
 */
async function move(index: number, to: number, direction: "up" | "down"): Promise<void> {
  if (locked.value || to < 0 || to >= selected.value.length) return;
  const slug = selected.value[index]!;
  store(moveItem(selected.value, index, to));
  announce(`"${titleFor(slug)}" is now at position ${to + 1} of ${selected.value.length}.`);
  await nextTick();
  list.value?.querySelector<HTMLElement>(`[data-move="${CSS.escape(`${slug}:${direction}`)}"]`)?.focus();
}

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
      <ol
        v-if="selected.length > 0"
        ref="list"
        class="mb-2 divide-y divide-line rounded-sm border border-line bg-raised"
        :aria-label="`Chosen ${targetLabel.toLowerCase()}`"
      >
        <li v-for="(slug, index) in selected" :key="slug" class="flex items-center gap-2 px-3 py-1.5 text-sm">
          <span class="min-w-0 flex-1 truncate">{{ titleFor(slug) }}</span>
          <span class="shrink-0 font-mono text-[11px] text-muted">{{ slug }}</span>
          <template v-if="field.multiple && selected.length > 1">
            <button
              type="button"
              :data-move="`${slug}:up`"
              class="btn-ghost px-1.5 py-0.5 text-xs aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
              :aria-disabled="locked || index === 0 || undefined"
              @click="move(index, index - 1, 'up')"
            >
              <span aria-hidden="true">↑</span><span class="sr-only">Move "{{ titleFor(slug) }}" up</span>
            </button>
            <button
              type="button"
              :data-move="`${slug}:down`"
              class="btn-ghost px-1.5 py-0.5 text-xs aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
              :aria-disabled="locked || index === selected.length - 1 || undefined"
              @click="move(index, index + 1, 'down')"
            >
              <span aria-hidden="true">↓</span><span class="sr-only">Move "{{ titleFor(slug) }}" down</span>
            </button>
          </template>
          <button
            type="button"
            class="btn-ghost px-1.5 py-0.5 text-xs aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
            :aria-disabled="locked || undefined"
            @click="remove(slug)"
          >
            Remove<span class="sr-only"> "{{ titleFor(slug) }}"</span>
          </button>
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
