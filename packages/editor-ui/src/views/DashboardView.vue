<script setup lang="ts">
/**
 * Dashboard: counts, where the content lives, and the pending changes.
 * No "Rebuild website" button: the published commit triggers the repository's own pipeline.
 * No "recently edited" list: only the repository's history can say that truthfully.
 */

import { computed, onMounted, ref } from "vue";

import { api, ApiError, type Overview } from "@/api";
import PageHeader from "@/components/PageHeader.vue";
import { useSession } from "@/stores/session";
import { useStaging } from "@/stores/staging";
import { useToast } from "@/stores/toast";

const session = useSession();
const staging = useStaging();
const toast = useToast();

const overview = ref<Overview | null>(null);
const loading = ref(true);

/** Greets by name only when the provider gave one; local mode has no user. */
const greeting = computed(() => {
  const name = session.identity.value?.name?.split(" ")[0];
  if (!name) return "Overview";

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

      <section
        v-if="(staging.status.value?.sync?.conflicts.length ?? 0) > 0"
        role="alert"
        class="rounded-md border border-warning/15 bg-warning-soft p-4"
        aria-labelledby="conflicts-heading"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="conflicts-heading" class="text-sm font-semibold text-warning">
              Changed on the website while you edited
            </h2>
            <p class="mt-1 text-sm text-muted">
              Choose a version for each. Until then, nothing can be published.
            </p>
          </div>
          <RouterLink :to="{ name: 'changes' }" class="btn-secondary">Choose versions</RouterLink>
        </div>
      </section>

      <section
        v-if="staging.editCount.value > 0"
        class="card p-4"
        aria-labelledby="pending-heading"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="pending-heading" class="text-sm font-semibold">
              {{ staging.editCount.value }} edit{{ staging.editCount.value === 1 ? "" : "s" }}
              waiting to be published
            </h2>
            <p class="mt-1 text-sm text-muted">
              Saved, and not yet in the repository. The whole set is published together.
            </p>
          </div>
          <RouterLink :to="{ name: 'changes' }" class="btn-secondary">Review and publish</RouterLink>
        </div>
      </section>

      <section class="card p-4" aria-labelledby="repository-heading">
        <h2 id="repository-heading" class="text-sm font-semibold">Content repository</h2>

        <p class="mt-2 break-all font-mono text-xs text-muted">{{ overview.repository }}</p>

        <p class="mt-3 text-sm text-muted">
          Every entry and every uploaded file becomes a file in this repository when it is
          published, so the website can be rebuilt from the repository alone — with or without
          this server.
        </p>
      </section>
    </template>
  </div>
</template>
