<script setup lang="ts">
/**
 * Collection overview: a filterable list of entries.
 * Columns come from fields marked `listed` in the model.
 *
 * A row says "New" or "Changed" while the entry has saved changes that are
 * not on the website yet; removed entries are counted above the list.
 */

import { computed, onMounted, ref, watch } from "vue";
import { Plus } from "@lucide/vue";

import { api, messageOf, type EntrySummary, type UnreadableEntry } from "@/api";
import PageHeader from "@/components/PageHeader.vue";
import ReadOnlyNotice from "@/components/ReadOnlyNotice.vue";
import ReorderArrows from "@/components/ReorderArrows.vue";
import ReorderHandle from "@/components/ReorderHandle.vue";
import StatusNotice from "@/components/StatusNotice.vue";
import { useReorder } from "@/composables/useReorder";
import { previewValue } from "@/lib/format";
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
/** Why the entries could not be loaded: the list is then not "empty". */
const loadError = ref<string | null>(null);
/** Entries whose files Mica cannot read. The list shows the others. */
const unreadable = ref<UnreadableEntry[]>([]);
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

const emptyTitle = computed(() =>
  search.value ? `Nothing matches "${search.value}".` : `No ${definition.value?.label.toLowerCase()} yet.`,
);

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
  loadError.value = null;
  try {
    const listed = await api.entries.list(props.collection);
    entries.value = listed.items;
    unreadable.value = listed.unreadable;
    orderRevision = listed.orderRevision;
  } catch (error) {
    entries.value = [];
    unreadable.value = [];
    loadError.value = messageOf(error, "Something went wrong.");
  } finally {
    loading.value = false;
  }
}

onMounted(load);

/**
 * Manual ordering.
 *
 * The order is a `_order.json` file listing slugs, so moving one entry is a
 * one-line diff rather than a rewrite of every entry in the collection. Each
 * move saves once, however far the entry goes: by drag or by the keyboard on
 * the handle, or one step with an arrow.
 */
async function saveOrder(next: EntrySummary[], moved: EntrySummary): Promise<void> {
  entries.value = next;
  if (next.map((entry) => entry.slug).join("/") === savedOrder) return;

  reordering.value = true;
  try {
    ({ revision: orderRevision } = await api.entries.reorder(
      props.collection,
      next.map((entry) => entry.slug),
      orderRevision,
    ));
    savedOrder = next.map((entry) => entry.slug).join("/");
    void staging.refresh();
  } catch (error) {
    toast.error(messageOf(error, "Could not save the new order."));
    await load();
  } finally {
    reordering.value = false;
  }
}

/** The order on the server, so that a move that ends where it started saves nothing. */
let savedOrder = "";
/** The revision of the order the editor sees: a colleague's move in between is a conflict, not an overwrite. */
let orderRevision: string | null = null;
watch(loading, (isLoading) => {
  if (!isLoading) savedOrder = entries.value.map((entry) => entry.slug).join("/");
});

// Reordering a filtered list would move the wrong neighbours.
const sortable = computed(() => (definition.value?.sortable ?? false) && !definition.value?.readOnly);
// A new order without the entries that cannot be read would move them to the end.
const canReorder = computed(() => sortable.value && !search.value && unreadable.value.length === 0);

const reorder = useReorder<EntrySummary>({
  scope: () => `entries-${props.collection}`,
  items: () => entries.value,
  show: (next) => (entries.value = next),
  commit: saveOrder,
  id: (entry) => entry.slug,
  label: (entry) => entry.title,
  disabled: () => reordering.value,
});
</script>

<template>
  <template v-if="definition">
    <PageHeader
      :title="definition.label"
      :subtitle="
        definition.description ??
        (loadError ? undefined : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`)
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
      <div v-if="unreadable.length > 0" role="status" class="mb-3 rounded-md border border-warning/15 bg-warning-soft p-4">
        <p class="text-sm font-medium text-warning">
          {{ unreadable.length === 1 ? "1 entry cannot be opened" : `${unreadable.length} entries cannot be opened` }}
        </p>
        <p class="mt-1 text-xs text-muted">
          Their files have a problem, so the list does not show them. Ask a developer to repair these files.
          <template v-if="sortable">You can change the order again after that.</template>
        </p>
        <ul class="mt-2 space-y-1 text-xs">
          <li v-for="entry in unreadable" :key="entry.slug">
            <!-- The message names the file. -->
            <span class="font-mono">{{ entry.message }}</span>
          </li>
        </ul>
      </div>
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
        again to drop it. Escape puts it back. The arrows at the end of the row move it one step.
      </p>

      <StatusNotice
        v-if="loadError"
        kind="error"
        :title="`The ${definition.label.toLowerCase()} could not be loaded`"
        :message="loadError"
        @retry="load"
      />

      <div v-else class="card overflow-hidden">
        <StatusNotice v-if="loading" kind="loading" />

        <StatusNotice
          v-else-if="matching.length === 0"
          kind="empty"
          :title="emptyTitle"
        >
          <RouterLink
            v-if="!search && !definition.readOnly"
            :to="{ name: 'entry-new', params: { collection } }"
            class="btn-primary mt-4"
          >
            Create the first {{ definition.labelSingular.toLowerCase() }}
          </RouterLink>
        </StatusNotice>

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
                <span class="sr-only">Move up or down</span>
              </th>
            </tr>
          </thead>

          <tbody class="divide-y divide-line">
            <tr
              v-for="(entry, index) in matching"
              :key="entry.slug"
              :class="['transition hover:bg-canvas', canReorder && reorder.isMoving(entry) && 'bg-accent-soft']"
              v-bind="canReorder ? reorder.row(entry) : {}"
            >
              <td v-if="canReorder" class="w-0 py-2.5 pl-2">
                <ReorderHandle
                  :label="entry.title"
                  described-by="order-help"
                  :disabled="reordering"
                  v-bind="reorder.handle(entry)"
                />
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
                <ReorderArrows
                  :label="entry.title"
                  :target="reorder.target(entry)"
                  :first="index === 0"
                  :last="index === matching.length - 1"
                  :disabled="reordering"
                  @move="reorder.step(entry, $event)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

  </template>

  <div v-else class="p-8 text-center text-sm text-muted">
    There is no collection called "{{ collection }}".
  </div>
</template>
