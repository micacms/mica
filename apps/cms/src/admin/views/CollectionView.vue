<script setup lang="ts">
/**
 * Collection overview: a filterable list of entries with their status.
 * Columns come from fields marked `listed` in the model.
 */

import { computed, onMounted, ref, watch } from "vue";

import type { EntryStatus } from "@micacms/model";

import { api, ApiError, type EntrySummary } from "@/api";
import PageHeader from "@/components/PageHeader.vue";
import { previewValue, relativeTime } from "@/lib/format";
import { useSchema } from "@/stores/schema";
import { useToast } from "@/stores/toast";

const props = defineProps<{ collection: string }>();

const schema = useSchema();
const toast = useToast();

const entries = ref<EntrySummary[]>([]);
const total = ref(0);
const loading = ref(true);
const search = ref("");
const status = ref<EntryStatus | "">("");
const reordering = ref(false);

const definition = computed(() => schema.collection(props.collection));
const columns = computed(() => {
  const def = definition.value;
  if (!def) return [];
  // The title already has its own column, so do not repeat it.
  return def.listedFields.filter((key) => key !== def.titleField);
});

let searchTimer: ReturnType<typeof setTimeout> | undefined;

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await api.entries.list(props.collection, {
      search: search.value,
      status: status.value,
      limit: 200,
    });
    entries.value = result.items;
    total.value = result.total;
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not load the entries.");
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => props.collection, load);
watch(status, load);
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 250);
});

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
      next.map((entry) => entry.id),
    );
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not save the new order.");
    await load();
  } finally {
    reordering.value = false;
  }
}

// Manual ordering is only meaningful in the unfiltered, unsorted list.
const canReorder = computed(
  () => (definition.value?.sortable ?? false) && !search.value && !status.value,
);
</script>

<template>
  <template v-if="definition">
    <PageHeader
      :title="definition.label"
      :subtitle="definition.description ?? `${total} ${total === 1 ? 'entry' : 'entries'}`"
    >
      <RouterLink
        :to="{ name: 'entry-new', params: { collection } }"
        class="btn-primary"
      >
        <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10 4v12M4 10h12" stroke-linecap="round" />
        </svg>
        New {{ definition.labelSingular.toLowerCase() }}
      </RouterLink>
    </PageHeader>

    <div class="mx-auto max-w-5xl px-4 py-5 sm:px-6">
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <input
          v-model="search"
          type="search"
          :placeholder="`Search ${definition.label.toLowerCase()}…`"
          class="input max-w-64"
          :aria-label="`Search ${definition.label}`"
        />

        <select v-model="status" class="input max-w-40" aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
      </div>

      <div class="card overflow-hidden">
        <p v-if="loading" class="px-4 py-8 text-center text-sm text-muted">Loading…</p>

        <div v-else-if="entries.length === 0" class="px-4 py-12 text-center">
          <p class="text-sm font-medium">
            {{ search || status ? "Nothing matches those filters." : `No ${definition.label.toLowerCase()} yet.` }}
          </p>
          <RouterLink
            v-if="!search && !status"
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
              <th scope="col" class="px-4 py-2 font-medium">Status</th>
              <th scope="col" class="hidden px-4 py-2 text-right font-medium sm:table-cell">
                Updated
              </th>
              <th v-if="canReorder" scope="col" class="px-2 py-2">
                <span class="sr-only">Reorder</span>
              </th>
            </tr>
          </thead>

          <tbody class="divide-y divide-line">
            <tr
              v-for="(entry, index) in entries"
              :key="entry.id"
              class="transition hover:bg-canvas"
            >
              <td class="px-4 py-2.5">
                <RouterLink
                  :to="{ name: 'entry', params: { collection, id: entry.id } }"
                  class="font-medium hover:underline"
                >
                  {{ entry.title }}
                </RouterLink>
                <span class="block font-mono text-xs text-muted">/{{ entry.slug }}</span>
              </td>

              <td
                v-for="column in columns"
                :key="column"
                class="hidden px-4 py-2.5 text-muted md:table-cell"
              >
                {{ previewValue(entry.data[column]) }}
              </td>

              <td class="px-4 py-2.5">
                <span
                  :class="[
                    'badge',
                    entry.status === 'published'
                      ? 'bg-success/10 text-success'
                      : 'bg-warning/10 text-warning',
                  ]"
                >
                  {{ entry.status === "published" ? "Published" : "Draft" }}
                </span>
              </td>

              <td class="hidden px-4 py-2.5 text-right text-xs text-muted sm:table-cell">
                <time :datetime="entry.updatedAt">{{ relativeTime(entry.updatedAt) }}</time>
              </td>

              <td v-if="canReorder" class="px-2 py-2.5">
                <div class="flex justify-end gap-0.5">
                  <button
                    type="button"
                    class="btn-ghost px-1 py-0.5"
                    :disabled="index === 0 || reordering"
                    @click="move(index, -1)"
                  >
                    <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.75">
                      <path d="M10 15V5M6 9l4-4 4 4" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                    <span class="sr-only">Move "{{ entry.title }}" up</span>
                  </button>
                  <button
                    type="button"
                    class="btn-ghost px-1 py-0.5"
                    :disabled="index === entries.length - 1 || reordering"
                    @click="move(index, 1)"
                  >
                    <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.75">
                      <path d="M10 5v10M6 11l4 4 4-4" stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
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
