<script setup lang="ts">
/**
 * Dashboard.
 *
 * Counts and where the content lives, and deliberately little else.
 *
 * No draft count: an entry is saved or it is not. No "Rebuild website" button:
 * the commit is the trigger, and what follows belongs to the repository's own
 * pipeline. No "recently edited" list either — the honest source for that is
 * the repository's history, which a connector in front of a plain working tree
 * cannot read, and a half-true version would be worse than none.
 */

import { computed, onMounted, ref } from "vue";

import { api, ApiError, type Overview } from "@/api";
import PageHeader from "@/components/PageHeader.vue";
import { useAuth } from "@/stores/auth";
import { useToast } from "@/stores/toast";

const auth = useAuth();
const toast = useToast();

const overview = ref<Overview | null>(null);
const loading = ref(true);

const greeting = computed(() => {
  const name = auth.user.value?.name?.split(" ")[0] || "there";
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return `${part}, ${name}`;
});

const entries = computed(() =>
  (overview.value?.collections ?? []).reduce((total, item) => total + item.total, 0),
);

onMounted(async () => {
  try {
    overview.value = await api.overview();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not load the overview.");
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <PageHeader
    :title="greeting"
    :subtitle="`${entries} entr${entries === 1 ? 'y' : 'ies'} in the content repository`"
  />

  <div class="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
    <p v-if="loading" class="text-sm text-muted">Loading…</p>

    <template v-else-if="overview">
      <section aria-labelledby="content-heading">
        <h2 id="content-heading" class="sr-only">Content</h2>

        <ul class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <li v-for="collection in overview.collections" :key="collection.name">
            <RouterLink
              :to="{ name: 'collection', params: { collection: collection.name } }"
              class="card block p-4 transition hover:border-line-strong hover:bg-raised"
            >
              <p class="text-sm text-muted">{{ collection.label }}</p>
              <p class="mt-1 text-[30px] font-light leading-9 tabular-nums">{{ collection.total }}</p>
              <p class="mt-1 text-xs text-muted">
                {{ collection.total === 1 ? "entry" : "entries" }}
              </p>
            </RouterLink>
          </li>

          <li>
            <RouterLink :to="{ name: 'media' }" class="card block p-4 transition hover:border-line-strong hover:bg-raised">
              <p class="text-sm text-muted">Media</p>
              <p class="mt-1 text-[30px] font-light leading-9 tabular-nums">{{ overview.media.files }}</p>
              <p class="mt-1 text-xs text-muted">{{ overview.media.readable }}</p>
            </RouterLink>
          </li>
        </ul>
      </section>

      <section class="card p-4" aria-labelledby="repository-heading">
        <h2 id="repository-heading" class="text-sm font-semibold">Content repository</h2>

        <p class="mt-2 break-all font-mono text-xs text-muted">{{ overview.repository }}</p>

        <p class="mt-3 text-sm text-muted">
          Every entry and every uploaded file is a file in this repository. Saving writes it there,
          so the website can be rebuilt from the repository alone — with or without this server.
        </p>
      </section>
    </template>
  </div>
</template>
