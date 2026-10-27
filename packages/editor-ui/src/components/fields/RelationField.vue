<script setup lang="ts">
/**
 * Relation field. Stores entry IDs, so a reference is readable both in the
 * JSON payload and in the diff a reviewer reads.
 *
 * The chosen entries come first, in their stored order. They change their order
 * as every list does (`useReorder`): a handle to drag or to move with the
 * keyboard, and arrows. Below them, `RelationSearch` finds an entry by its title
 * or ID as the editor types.
 *
 * A single relation with a value shows only the chosen entry. Its Change action
 * opens a dialog with the search, so a form with many relations stays short (#351).
 */

import { computed, nextTick, onMounted, ref, useId } from "vue";

import type { RelationField } from "@micacms/core/internal";

import FieldShell from "./FieldShell.vue";
import RelationSearch from "./RelationSearch.vue";
import ReorderArrows from "@/components/ReorderArrows.vue";
import ReorderHandle from "@/components/ReorderHandle.vue";
import { useField, type FieldProps } from "@/composables/useField";
import { useDialogFocus } from "@/composables/useDialogFocus";
import { usePreviewPane } from "@/composables/usePreviewPane";
import { useReorder } from "@/composables/useReorder";
import { announce } from "@/lib/announce";
import { focusListItem, reportListItem } from "@/lib/focus";
import { entryOptions, type RelationOption } from "@/lib/entry-options";
import { addressOf } from "@/lib/locales";
import { useSchema } from "@/stores/schema";

const props = defineProps<FieldProps & { modelValue: unknown }>();
const emit = defineEmits<{ "update:modelValue": [string | string[] | null] }>();

const field = computed(() => props.field as RelationField);
const { inputId, label, error, describedBy, hintId, errorId, locked } = useField(props);
const schema = useSchema();

const options = ref<RelationOption[]>([]);
const loading = ref(true);
const failed = ref(false);

const target = computed(() => schema.collection(field.value.collection));
/** A reference set: data of the website that the editor only chooses from. */
const reference = computed(() => schema.reference(field.value.collection));
const targetLabel = computed(() => target.value?.label ?? reference.value?.label ?? field.value.collection);
const singular = computed(() => (target.value?.labelSingular ?? (reference.value ? "item" : "entry")).toLowerCase());
/** "a waypoint", "an entry". */
const aSingular = computed(() => `${/^[aeiou]/.test(singular.value) ? "an" : "a"} ${singular.value}`);

onMounted(async () => {
  try {
    // The default locale's page: the choices show one address for each entry.
    options.value = await entryOptions(field.value.collection, reference.value !== undefined, target.value?.url, addressOf(schema.site.value?.locales));
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

const pane = usePreviewPane();

/** "Edit": the chosen entry in the overlay form, over this one. A reference set is data of the code: it has none. */
function edit(id: string): void {
  pane.openOverlay({ kind: "entry", document: field.value.collection, id, field: "" });
}

const titleFor = (id: string): string => options.value.find((item) => item.id === id)?.title ?? id;
/** Beside a chosen entry: its page's URL when the collection has one, else its ID. */
const addressFor = (id: string): string => options.value.find((item) => item.id === id)?.url ?? id;

const isMissing = (id: string): boolean => !loading.value && !failed.value && !options.value.some((item) => item.id === id);

function store(ids: string[]): void {
  emit("update:modelValue", field.value.multiple ? ids : (ids[0] ?? null));
}

const search = ref<InstanceType<typeof RelationSearch> | null>(null);

const reorder = useReorder<string>({
  scope: () => `relation-${props.path}`,
  items: () => selected.value,
  show: store,
  // The form keeps the order: the next save writes it.
  commit: () => {},
  id: (id) => id,
  label: titleFor,
  disabled: () => locked.value,
});

async function remove(id: string): Promise<void> {
  if (locked.value) return;
  store(selected.value.filter((item) => item !== id));
  announce(`Removed "${titleFor(id)}".`);
  await nextTick();
  search.value?.input?.focus();
}

/** The search below the chosen entries: always for a list, and for a single relation without a value. */
const searchInline = computed(() => field.value.multiple || selected.value.length === 0);

const placeholder = computed(() =>
  options.value.length === 0
    ? `There are no ${targetLabel.value.toLowerCase()} yet`
    : locked.value
      ? selected.value.length === 0 ? "Not set" : ""
      : `Find ${aSingular.value} to add…`,
);

/** The Change button of a single relation, which takes the focus when the search goes. */
const changeButton = ref<HTMLButtonElement | null>(null);
// A function ref: in the list of chosen entries, a plain `ref` would collect an array.
const setChangeButton = (element: unknown) => {
  changeButton.value = element instanceof HTMLButtonElement ? element : null;
};

async function choose(entry: RelationOption): Promise<void> {
  if (field.value.multiple) {
    store([...selected.value, entry.id]);
    return;
  }
  store([entry.id]);
  announce(`Chose "${entry.title}".`);
  await nextTick();
  changeButton.value?.focus();
}

/* The Change dialog of a single relation. */

const dialogId = useId();
const changing = ref(false);
const panel = ref<HTMLElement | null>(null);
const changeSearch = ref<InstanceType<typeof RelationSearch> | null>(null);
const changeInput = computed(() => changeSearch.value?.input ?? null);
const { trapTab } = useDialogFocus(() => changing.value, panel, changeInput);

function change(): void {
  if (!locked.value) changing.value = true;
}

function changeTo(entry: RelationOption): void {
  if (locked.value) return;
  store([entry.id]);
  changing.value = false;
  announce(`Changed to "${entry.title}".`);
}

function onDialogKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && !event.defaultPrevented) changing.value = false;
  trapTab(event);
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
    :as="loading || failed || searchInline ? 'label' : 'group'"
    :described-by="describedBy"
    @focus-block="focusListItem($event, 'ol')"
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
          v-for="(id, index) in selected"
          :key="field.multiple ? id : 'chosen'"
          :class="['flex items-center gap-2 py-1.5 pr-1.5 text-sm', field.multiple ? 'pl-1' : 'pl-3', reorder.isMoving(id) && 'bg-accent-soft']"
          v-bind="field.multiple ? reorder.row(id) : {}"
          @focusin="field.multiple && reportListItem($event, index)"
        >
          <ReorderHandle
            v-if="field.multiple"
            :label="titleFor(id)"
            :described-by="`${inputId}-order-help`"
            :disabled="locked"
            v-bind="reorder.handle(id)"
          />
          <span class="min-w-0 flex-1 truncate">{{ titleFor(id) }}</span>
          <span class="min-w-0 shrink truncate font-mono text-[11px] text-muted" :title="addressFor(id)">{{ addressFor(id) }}</span>
          <button v-if="target && !isMissing(id)" type="button" class="btn-ghost px-1.5 py-0.5 text-xs" @click="edit(id)">
            Edit<span class="sr-only"> "{{ titleFor(id) }}"</span>
          </button>
          <button
            v-if="!field.multiple"
            :ref="setChangeButton"
            type="button"
            class="btn-ghost px-1.5 py-0.5 text-xs aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
            :aria-disabled="locked || undefined"
            aria-haspopup="dialog"
            @click="change"
          >
            Change<span class="sr-only"> "{{ titleFor(id) }}"</span>
          </button>
          <button
            type="button"
            class="btn-ghost px-1.5 py-0.5 text-xs aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
            :aria-disabled="locked || undefined"
            @click="remove(id)"
          >
            Remove<span class="sr-only"> "{{ titleFor(id) }}"</span>
          </button>
          <ReorderArrows
            v-if="field.multiple"
            :label="titleFor(id)"
            :target="reorder.target(id)"
            :first="index === 0"
            :last="index === selected.length - 1"
            :disabled="locked"
            @move="reorder.step(id, $event)"
          />
        </li>
      </ol>

      <RelationSearch
        v-if="searchInline"
        ref="search"
        :input-id="inputId"
        :options="options"
        :exclude="selected"
        :placeholder="placeholder"
        :list-label="targetLabel"
        :singular="singular"
        :readonly="locked || options.length === 0"
        :invalid="!!error"
        :described-by="describedBy"
        @choose="choose"
      />

      <Teleport to="body">
        <div
          v-if="changing"
          class="fixed inset-0 z-50 grid place-items-center bg-scrim p-4"
          @click.self="changing = false"
          @keydown="onDialogKeydown"
        >
          <div
            ref="panel"
            role="dialog"
            aria-modal="true"
            :aria-labelledby="`${dialogId}-title`"
            class="w-full max-w-md rounded-xl border border-line bg-raised p-5 shadow-2xl"
          >
            <h2 :id="`${dialogId}-title`" class="text-base font-semibold">Change: {{ label }}</h2>
            <p class="mt-3 flex items-center gap-2 text-sm">
              <span class="text-muted">Now:</span>
              <span class="min-w-0 flex-1 truncate">{{ titleFor(selected[0] ?? "") }}</span>
              <span class="min-w-0 shrink truncate font-mono text-[11px] text-muted">{{ addressFor(selected[0] ?? "") }}</span>
            </p>

            <label :for="`${dialogId}-search`" class="field-label mt-4">Find another {{ singular }}</label>
            <div class="mt-1.5">
              <RelationSearch
                ref="changeSearch"
                :input-id="`${dialogId}-search`"
                :options="options"
                :exclude="selected"
                :placeholder="`Find ${aSingular}…`"
                :readonly="locked || options.length === 0"
                :list-label="targetLabel"
                :singular="singular"
                inline
                @choose="changeTo"
              />
            </div>

            <div class="mt-5 flex justify-end">
              <button type="button" class="btn-secondary" @click="changing = false">Cancel</button>
            </div>
          </div>
        </div>
      </Teleport>
    </template>

    <!-- A reference whose target was deleted or renamed would silently vanish
         from the frontend; say so instead. -->
    <p v-for="id in selected.filter(isMissing)" :key="id" class="field-error">
      "{{ titleFor(id) }}" is no longer in {{ targetLabel }}.
    </p>
  </FieldShell>
</template>
