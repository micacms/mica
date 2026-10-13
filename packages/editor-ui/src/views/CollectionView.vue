<script setup lang="ts">
/**
 * Collection overview: a filterable list of entries.
 * Columns come from fields marked `listed` in the model.
 *
 * A row says "New" or "Changed" while the entry has saved changes that are
 * not on the website yet; removed entries are counted above the list.
 */

import { computed, onMounted, ref, watch } from "vue";
import { ArrowDown, ArrowUp, Plus } from "@lucide/vue";

import { api, ApiError, type EntrySummary } from "@/api";
import PageHeader from "@/components/PageHeader.vue";
import ReadOnlyNotice from "@/components/ReadOnlyNotice.vue";
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
      JSON.stringify(entry.data).toLowerCase().includes(term),
  );
});

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
 * one-line diff rather than a rewrite of every entry in the collection.
 */
async function move(index: number, direction: -1 | 1): Promise<void> {
  const target = index + direction;
  if (target < 0 || target >= entries.value.length) return;

  const next = [...entries.value];
  [next[index], next[target]] = [next[target]!, next[index]!];
  entries.value = next;

  reordering.value = true;
  try {
    await api.entries.reorder(
      props.collection,
      next.map((entry) => entry.slug),
    );
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not save the new order.");
    await load();
  } finally {
    reordering.value = false;
  }
}

// Reordering a filtered list would move the wrong neighbours.
const canReorder = computed(
  () => (definition.value?.sortable ?? false) && !definition.value?.readOnly && !search.value,
);
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
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <input
          v-model="search"
          type="search"
          :placeholder="`Search ${definition.label.toLowerCase()}…`"
          class="input max-w-64"
          :aria-label="`Search ${definition.label}`"
        />
      </div>

      <div class="card overflow-hidden">
        <p v-if="loading" class="px-4 py-8 text-center text-sm text-muted">Loading…</p>

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
              <th scope="col" class="px-4 py-2 font-medium">Title</th>
              <th
                v-for="column in columns"
                :key="column"
                scope="col"
                class="hidden px-4 py-2 font-medium md:table-cell"
              >
                {{ definition.fields[column]?.label ?? column }}
              </th>
              <th v-if="canReorder" scope="col" class="px-2 py-2">
                <span class="sr-only">Reorder</span>
              </th>
            </tr>
          </thead>

          <tbody class="divide-y divide-line">
            <tr v-for="(entry, index) in matching" :key="entry.slug" class="transition hover:bg-canvas">
              <td class="px-4 py-2.5">
                <RouterLink
                  :to="{ name: 'entry', params: { collection, slug: entry.slug } }"
                  class="font-medium hover:underline"
                >
                  {{ entry.title }}
                </RouterLink>
                <span v-if="pendingStates.states.has(entry.slug)" class="ml-2 text-xs text-warning">
                  {{ pendingStates.states.get(entry.slug) === "new" ? "New" : "Changed" }} · not published
                </span>
                <span class="block font-mono text-xs text-muted">/{{ entry.slug }}</span>
              </td>

              <td
                v-for="column in columns"
                :key="column"
                class="hidden px-4 py-2.5 text-muted md:table-cell"
              >
                {{ previewValue(entry.data[column]) }}
              </td>

              <td v-if="canReorder" class="px-2 py-2.5">
                <div class="flex justify-end gap-0.5">
                  <button
                    type="button"
                    class="btn-ghost px-1 py-0.5"
                    :disabled="index === 0 || reordering"
                    @click="move(index, -1)"
                  >
                    <ArrowUp :size="16" aria-hidden="true" />
                    <span class="sr-only">Move "{{ entry.title }}" up</span>
                  </button>
                  <button
                    type="button"
                    class="btn-ghost px-1 py-0.5"
                    :disabled="index === matching.length - 1 || reordering"
                    @click="move(index, 1)"
                  >
                    <ArrowDown :size="16" aria-hidden="true" />
                    <span class="sr-only">Move "{{ entry.title }}" down</span>
                  </button>
                </div>
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
