<script setup lang="ts">
/**
 * Finds an entry by its title or URL as the editor types: the ARIA combobox
 * pattern. A relation field shows it below its chosen entries, and in its
 * Change dialog with the list `inline`, so that the list makes the dialog taller.
 */

import { computed, ref } from "vue";

import type { RelationOption } from "@/lib/entry-options";
import { matchEntries } from "@/lib/order";

const props = withDefaults(
  defineProps<{
    inputId: string;
    options: RelationOption[];
    /** The chosen slugs, which the list leaves out. */
    exclude: string[];
    placeholder: string;
    /** The name of the list, such as the collection's label. */
    listLabel: string;
    singular: string;
    readonly?: boolean;
    invalid?: boolean;
    describedBy?: string;
    inline?: boolean;
  }>(),
  { readonly: false, invalid: false, describedBy: undefined, inline: false },
);

const emit = defineEmits<{ choose: [RelationOption] }>();

const input = ref<HTMLInputElement | null>(null);
defineExpose({ input });

const listboxId = `${props.inputId}-listbox`;
const optionId = (index: number) => `${props.inputId}-option-${index}`;
const query = ref("");
const open = ref(false);
const active = ref(-1);

const results = computed(() => matchEntries(props.options, query.value, props.exclude));

function show(): void {
  if (props.readonly) return;
  open.value = true;
  active.value = -1;
}

function choose(entry: RelationOption): void {
  query.value = "";
  open.value = false;
  active.value = -1;
  emit("choose", entry);
}

function onKeydown(event: KeyboardEvent): void {
  if (props.readonly) return;
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
      // In a dialog, Escape without a query closes the dialog at once.
      if (props.inline && query.value === "") break;
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
  if (props.readonly) return;
  query.value = (event.target as HTMLInputElement).value;
  open.value = true;
  active.value = results.value.length > 0 ? 0 : -1;
}
</script>

<template>
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
      :aria-invalid="invalid ? 'true' : undefined"
      :aria-describedby="describedBy"
      :value="query"
      :placeholder="placeholder"
      :readonly="readonly"
      :class="['input', invalid && 'input-invalid']"
      @input="onInput"
      @focus="show"
      @blur="open = false"
      @keydown="onKeydown"
    />

    <ul
      v-show="open && results.length > 0"
      :id="listboxId"
      role="listbox"
      :aria-label="listLabel"
      :class="[
        'max-h-64 overflow-y-auto rounded-md border border-line bg-raised py-1',
        inline ? 'mt-2' : 'absolute inset-x-0 top-full z-20 mt-1 shadow-lg',
      ]"
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
      {{ open && query ? `${results.length === 0 ? "No" : results.length} matching ${results.length === 1 ? singular : listLabel.toLowerCase()}` : "" }}
    </p>
  </div>
</template>
