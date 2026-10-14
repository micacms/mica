<script setup lang="ts">
/**
 * Collection overview: a filterable list of entries.
 * Columns come from fields marked `listed` in the model.
 *
 * A row says "New" or "Changed" while the entry has saved changes that are
 * not on the website yet; removed entries are counted above the list.
 */

import { computed, nextTick, onMounted, ref, watch } from "vue";
import { GripVertical, ListOrdered, Plus } from "@lucide/vue";

import { api, ApiError, type EntrySummary } from "@/api";
import InputDialog from "@/components/InputDialog.vue";
import PageHeader from "@/components/PageHeader.vue";
import ReadOnlyNotice from "@/components/ReadOnlyNotice.vue";
import { announce } from "@/lib/announce";
import { previewValue } from "@/lib/format";
import { moveItem } from "@/lib/order";
import { useSchema } from "@/stores/schema";
import { useStaging } from "@/stores/staging";
import { useToast } from "@/stores/toast";

const props = defineProps<{ collection: string }>();

const schema = useSchema();
const staging = useStaging();
const toast = useToast();

/** Each entry's pending state, by slug, and the entries that publishing removes. */
const pendingStates = computed(() => {
  const states = new Map<string, "new" | "changed">();
  let removed = 0;
  for (const edit of staging.edits.value) {
    if (edit.target?.kind !== "entry" || edit.target.collection !== props.collection) continue;
    if (edit.state === "removed") removed += 1;
    else states.set(edit.target.slug, edit.state);
  }
  return { states, removed };
});

const entries = ref<EntrySummary[]>([]);
const loading = ref(true);
const search = ref("");
const reordering = ref(false);

const definition = computed(() => schema.collection(props.collection));
const columns = computed(() => {
  const def = definition.value;
  if (!def) return [];
  // The title already has its own column, so do not repeat it.
  return def.listedFields.filter((key) => key !== def.titleField);
});

const matching = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return entries.value;

  // In the browser: the whole collection is already here, and a round trip per
  // keystroke would only add latency.
  return entries.value.filter(
    (entry) =>
      entry.title.toLowerCase().includes(term) ||
      entry.slug.includes(term) ||
      searchableText(entry.data).includes(term),
  );
});

/** The values of an entry, without its field names: "title" must not match every entry. */
function searchableText(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(searchableText).join(" ");
  if (value !== null && typeof value === "object") return Object.values(value).map(searchableText).join(" ");
  return "";
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    entries.value = (await api.entries.list(props.collection)).items;
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not load the entries.");
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => props.collection, load);

/**
 * Manual ordering.
 *
 * The order is a `_order.json` file listing slugs, so moving one entry is a
 * one-line diff rather than a rewrite of every entry in the collection. Each
 * move saves once, however far the entry goes: by drag, by the keyboard on
 * the handle, or with "Move to position".
 */
async function saveOrder(next: EntrySummary[], moved: EntrySummary): Promise<void> {
  entries.value = next;
  if (next.map((entry) => entry.slug).join("/") === savedOrder) return;

  reordering.value = true;
  try {
    await api.entries.reorder(
      props.collection,
      next.map((entry) => entry.slug),
    );
    savedOrder = next.map((entry) => entry.slug).join("/");
    announce(`"${moved.title}" is now at position ${next.indexOf(moved) + 1} of ${next.length}.`);
    void staging.refresh();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not save the new order.");
    await load();
  } finally {
    reordering.value = false;
  }
}

/** The order on the server, so that a move that ends where it started saves nothing. */
let savedOrder = "";
watch(loading, (isLoading) => {
  if (!isLoading) savedOrder = entries.value.map((entry) => entry.slug).join("/");
});

// Reordering a filtered list would move the wrong neighbours.
const sortable = computed(() => (definition.value?.sortable ?? false) && !definition.value?.readOnly);
const canReorder = computed(() => sortable.value && !search.value);

/* The keyboard: Space picks the entry up, the arrows, Home and End move it, Space drops it, Escape puts it back. */

const lifted = ref<{ slug: string; original: EntrySummary[] } | null>(null);

async function focusRow(slug: string, control: "handle" | "position" = "handle"): Promise<void> {
  await nextTick();
  document.querySelector<HTMLElement>(`[data-${control}="${CSS.escape(slug)}"]`)?.focus();
}

function putBack(): void {
  const current = lifted.value;
  if (!current) return;
  entries.value = current.original;
  lifted.value = null;
  const entry = entries.value.find((item) => item.slug === current.slug);
  if (entry) announce(`"${entry.title}" is back at position ${entries.value.indexOf(entry) + 1}.`);
}

function onHandleKeydown(event: KeyboardEvent, entry: EntrySummary): void {
  // Only the entry that was picked up moves; a key on another handle puts it back first.
  if (lifted.value && lifted.value.slug !== entry.slug) putBack();

  const index = entries.value.indexOf(entry);
  const count = entries.value.length;

  if (!lifted.value) {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    lifted.value = { slug: entry.slug, original: entries.value };
    announce(`Picked up "${entry.title}", position ${index + 1} of ${count}. Use the arrow keys, Home or End, then Space to drop.`);
    return;
  }

  const to = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: count - 1 }[event.key];
  if (to !== undefined) {
    event.preventDefault();
    if (to < 0 || to >= count || to === index) return;
    entries.value = moveItem(entries.value, index, to);
    announce(`Position ${to + 1} of ${count}.`);
    void focusRow(entry.slug);
  } else if (event.key === " " || event.key === "Enter") {
    event.preventDefault();
    lifted.value = null;
    void saveOrder(entries.value, entry).then(() => focusRow(entry.slug));
  } else if (event.key === "Escape") {
    event.preventDefault();
    putBack();
    void focusRow(entry.slug);
  }
}

/**
 * Leaving the handle puts a picked-up entry back. Vue also blurs the handle
 * when it moves the row, and `focusRow` returns the focus before this check.
 */
function onHandleBlur(): void {
  window.setTimeout(() => {
    const current = lifted.value;
    if (current && (document.activeElement as HTMLElement | null)?.dataset["handle"] !== current.slug) putBack();
  }, 0);
}

/* The mouse: the handle arms its row, the row moves as it is dragged over others, and a drop saves. */

const armed = ref<string | null>(null);
const dragging = ref<EntrySummary | null>(null);
let dragOriginal: EntrySummary[] = [];
let dropped = false;

function onDragStart(event: DragEvent, entry: EntrySummary): void {
  dragging.value = entry;
  dragOriginal = entries.value;
  dropped = false;
  event.dataTransfer?.setData("text/plain", entry.slug);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function onDragOver(event: DragEvent, entry: EntrySummary): void {
  const moving = dragging.value;
  if (!moving) return;
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  if (moving === entry) return;
  entries.value = moveItem(entries.value, entries.value.indexOf(moving), entries.value.indexOf(entry));
}

function onDrop(): void {
  dropped = true;
}

// A drag that ends outside the list, or with Escape, puts the order back.
function onDragEnd(event: DragEvent): void {
  const moved = dragging.value;
  dragging.value = null;
  armed.value = null;
  if (!moved) return;
  if (!dropped || event.dataTransfer?.dropEffect === "none") {
    entries.value = dragOriginal;
    return;
  }
  void saveOrder(entries.value, moved);
}

/* "Move to position…" */

const moving = ref<EntrySummary | null>(null);
const positionValue = ref("");
const positionError = ref<string | null>(null);

function askPosition(entry: EntrySummary): void {
  moving.value = entry;
  positionValue.value = String(entries.value.indexOf(entry) + 1);
  positionError.value = null;
}

function applyPosition(): void {
  const entry = moving.value;
  if (!entry) return;
  const count = entries.value.length;
  const position = Number(positionValue.value);
  if (!Number.isInteger(position) || position < 1 || position > count) {
    positionError.value = `Type a whole number from 1 to ${count}.`;
    return;
  }
  moving.value = null;
  void saveOrder(moveItem(entries.value, entries.value.indexOf(entry), position - 1), entry).then(() =>
    focusRow(entry.slug, "position"),
  );
}
</script>

<template>
  <template v-if="definition">
    <PageHeader
      :title="definition.label"
      :subtitle="
        definition.description ??
        `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`
      "
    >
      <RouterLink v-if="!definition.readOnly" :to="{ name: 'entry-new', params: { collection } }" class="btn-primary">
        <Plus :size="16" aria-hidden="true" />
        New {{ definition.labelSingular.toLowerCase() }}
      </RouterLink>
    </PageHeader>

    <div class="mx-auto max-w-5xl px-4 py-5 sm:px-6">
      <ReadOnlyNotice v-if="definition.readOnly" :reason="definition.readOnly" />
      <p v-if="pendingStates.removed > 0" role="status" class="mb-3 text-sm text-muted">
        {{ pendingStates.removed }} {{ pendingStates.removed === 1 ? "entry is" : "entries are" }} removed, and
        still on the website until you
        <RouterLink :to="{ name: 'changes' }" class="underline">publish</RouterLink>.
      </p>
      <div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <input
          v-model="search"
          type="search"
          :placeholder="`Search ${definition.label.toLowerCase()}…`"
          class="input max-w-64"
          :aria-label="`Search ${definition.label}`"
          :aria-describedby="sortable && search ? 'order-paused' : undefined"
        />
        <p v-if="sortable && search" id="order-paused" class="text-xs text-muted">Clear the search to change the order.</p>
      </div>
      <p id="order-help" class="sr-only">
        To move an entry with the keyboard, press Space on its handle, then the arrow keys, Home or End, and Space
        again to drop it. Escape puts it back.
      </p>

      <div class="card overflow-hidden">
        <p v-if="loading" role="status" class="px-4 py-8 text-center text-sm text-muted">Loading…</p>

        <div v-else-if="matching.length === 0" class="px-4 py-12 text-center">
          <p class="text-sm font-medium">
            {{ search ? `Nothing matches "${search}".` : `No ${definition.label.toLowerCase()} yet.` }}
          </p>
          <RouterLink
            v-if="!search && !definition.readOnly"
            :to="{ name: 'entry-new', params: { collection } }"
            class="btn-primary mt-4"
          >
            Create the first {{ definition.labelSingular.toLowerCase() }}
          </RouterLink>
        </div>

        <table v-else class="w-full text-sm">
          <caption class="sr-only">{{ definition.label }}</caption>
          <thead>
            <tr class="border-b border-line text-left text-xs text-muted">
              <th v-if="canReorder" scope="col" class="w-0 py-2 pl-2">
                <span class="sr-only">Move</span>
              </th>
              <th scope="col" class="px-4 py-2 font-medium">Title</th>
              <th
                v-for="column in columns"
                :key="column"
                scope="col"
                class="hidden px-4 py-2 font-medium md:table-cell"
              >
                {{ definition.fields[column]?.label ?? column }}
              </th>
              <th v-if="canReorder" scope="col" class="w-0 px-2 py-2">
                <span class="sr-only">Position</span>
              </th>
            </tr>
          </thead>

          <tbody class="divide-y divide-line">
            <tr
              v-for="entry in matching"
              :key="entry.slug"
              :draggable="armed === entry.slug"
              :class="[
                'transition hover:bg-canvas',
                (lifted?.slug === entry.slug || dragging === entry) && 'bg-accent-soft',
              ]"
              @dragstart="onDragStart($event, entry)"
              @dragover.prevent="onDragOver($event, entry)"
              @drop.prevent="onDrop"
              @dragend="onDragEnd"
            >
              <td v-if="canReorder" class="w-0 py-2.5 pl-2">
                <button
                  type="button"
                  :data-handle="entry.slug"
                  class="btn-ghost cursor-grab px-1 py-0.5"
                  :aria-label="`Move “${entry.title}”`"
                  title="Drag, or press Space and use the arrow keys"
                  :aria-pressed="lifted?.slug === entry.slug"
                  aria-describedby="order-help"
                  :disabled="reordering"
                  @pointerdown="armed = entry.slug"
                  @pointerup="armed = null"
                  @keydown="onHandleKeydown($event, entry)"
                  @blur="onHandleBlur"
                >
                  <GripVertical :size="16" aria-hidden="true" />
                </button>
              </td>
              <td class="px-4 py-2.5">
                <RouterLink
                  :to="{ name: 'entry', params: { collection, slug: entry.slug } }"
                  class="font-medium hover:underline"
                >
                  {{ entry.title }}
                </RouterLink>
                <span v-if="pendingStates.states.has(entry.slug)" class="status status-draft ml-2">
                  {{ pendingStates.states.get(entry.slug) === "new" ? "New" : "Changed" }} · not published
                </span>
                <span class="block font-mono text-xs text-muted">/{{ entry.slug }}</span>
              </td>

              <td
                v-for="column in columns"
                :key="column"
                class="hidden px-4 py-2.5 text-muted md:table-cell"
              >
                {{ previewValue(entry.data[column], definition.fields[column]) }}
              </td>

              <td v-if="canReorder" class="w-0 px-2 py-2.5">
                <button
                  type="button"
                  :data-position="entry.slug"
                  class="btn-ghost px-1 py-0.5"
                  title="Move to a position"
                  :disabled="reordering"
                  @click="askPosition(entry)"
                >
                  <ListOrdered :size="16" aria-hidden="true" />
                  <span class="sr-only">Move "{{ entry.title }}" to a position</span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <InputDialog
      v-model="positionValue"
      :open="moving !== null"
      :title="`Move “${moving?.title ?? ''}”`"
      :label="`Position, from 1 to ${entries.length}`"
      type="number"
      :min="1"
      :max="entries.length"
      :error="positionError"
      confirm-label="Move"
      @confirm="applyPosition"
      @cancel="moving = null"
    />
  </template>

  <div v-else class="p-8 text-center text-sm text-muted">
    There is no collection called "{{ collection }}".
  </div>
</template>
