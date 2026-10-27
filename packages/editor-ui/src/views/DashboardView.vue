<script setup lang="ts">
/**
 * Dashboard: counts, where the content lives, the pending changes, and on a multilingual site, where translations are missing.
 * No "Rebuild website" button: the published commit triggers the repository's own pipeline.
 * No "recently edited" list: only the repository's history can say that truthfully.
 */

import { computed, onMounted, ref } from "vue";

import { api, messageOf, type Overview } from "@/api";
import DeveloperDetails from "@/components/DeveloperDetails.vue";
import PageHeader from "@/components/PageHeader.vue";
import StatusNotice from "@/components/StatusNotice.vue";
import { chooseFormLocale } from "@/composables/useFormLocale";
import { useSession } from "@/stores/session";
import { useStaging } from "@/stores/staging";

const session = useSession();
const staging = useStaging();

const overview = ref<Overview | null>(null);
const loading = ref(true);
const loadError = ref<string | null>(null);

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

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    overview.value = await api.overview();
  } catch (error) {
    loadError.value = messageOf(error, "Something went wrong.");
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <PageHeader
    :title="greeting"
    :subtitle="overview ? `${entries} entr${entries === 1 ? 'y' : 'ies'}` : undefined"
  />

  <div class="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
    <StatusNotice v-if="loading" kind="loading" />

    <StatusNotice v-else-if="loadError" kind="error" title="The overview could not be loaded" :message="loadError" @retry="load" />

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
              <p class="mt-1 text-[30px] font-normal leading-9 tabular-nums">{{ collection.total }}</p>
              <p class="mt-1 text-xs text-muted">
                {{ collection.total === 1 ? "entry" : "entries" }}
              </p>
            </RouterLink>
          </li>

          <li>
            <RouterLink :to="{ name: 'media' }" class="card block p-4 transition hover:border-line-strong hover:bg-raised">
              <p class="text-sm text-muted">Media</p>
              <p class="mt-1 text-[30px] font-normal leading-9 tabular-nums">{{ overview.media.files }}</p>
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
              {{ staging.editCount.value }} saved change{{ staging.editCount.value === 1 ? "" : "s" }}
              not on the website yet
            </h2>
            <p class="mt-1 text-sm text-muted">
              Choose which of them to publish. The others stay saved.
            </p>
          </div>
          <RouterLink :to="{ name: 'changes' }" class="btn-secondary">Review and publish</RouterLink>
        </div>
      </section>

      <section v-if="overview.translations.length > 0" class="card p-4" aria-labelledby="translations-heading">
        <h2 id="translations-heading" class="text-sm font-semibold">Translations</h2>
        <p class="mt-1 text-sm text-muted">Where a translation is missing, the website shows another language.</p>

        <ul class="mt-3 space-y-2 text-sm">
          <li v-for="item in overview.translations" :key="item.locale" class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span class="w-8 shrink-0 font-semibold">{{ item.locale.toUpperCase() }}</span>
            <span v-if="item.collections.length === 0 && item.singletons.length === 0" class="text-muted">Nothing is missing.</span>
            <RouterLink
              v-for="collection in item.collections"
              :key="collection.name"
              :to="{ name: 'collection', params: { collection: collection.name }, query: { missing: item.locale } }"
              class="underline"
            >
              {{ collection.label }}: {{ collection.entries }} {{ collection.entries === 1 ? "entry" : "entries" }}
            </RouterLink>
            <RouterLink
              v-for="singleton in item.singletons"
              :key="singleton.name"
              :to="{ name: 'singleton', params: { name: singleton.name } }"
              class="underline"
              @click="chooseFormLocale(item.locale)"
            >
              {{ singleton.label }}
            </RouterLink>
          </li>
        </ul>
      </section>

      <section class="card p-4" aria-labelledby="storage-heading">
        <h2 id="storage-heading" class="text-sm font-semibold">Where your content is kept</h2>

        <p class="mt-2 text-sm text-muted">
          Every entry and every uploaded file is kept as a file next to the website's code when it
          is published, so the website can be rebuilt from these files alone — with or without Mica.
        </p>

        <DeveloperDetails>
          <p class="break-all font-mono">{{ overview.repository }}</p>
        </DeveloperDetails>
      </section>
    </template>
  </div>
</template>
