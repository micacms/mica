<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import { api, ApiError, type Overview } from "@/api";
import PageHeader from "@/components/PageHeader.vue";
import { useAuth } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { relativeTime } from "@/lib/format";

const auth = useAuth();
const toast = useToast();

const overview = ref<Overview | null>(null);
const loading = ref(true);
const publishing = ref(false);

const greeting = computed(() => {
  const name = auth.user.value?.name?.split(" ")[0] || "there";
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return `${part}, ${name}`;
});

const drafts = computed(() =>
  (overview.value?.collections ?? []).reduce((total, item) => total + item.drafts, 0),
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

async function rebuild(): Promise<void> {
  publishing.value = true;
  try {
    await api.publish();
    toast.success("Website rebuild requested.");
    overview.value = await api.overview();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not trigger a rebuild.");
  } finally {
    publishing.value = false;
  }
}
</script>

<template>
  <PageHeader :title="greeting" :subtitle="`${drafts} unpublished draft${drafts === 1 ? '' : 's'}`">
    <button
      v-if="overview?.publisher.configured"
      type="button"
      class="btn-secondary"
      :disabled="publishing"
      @click="rebuild"
    >
      {{ publishing ? "Requesting…" : "Rebuild website" }}
    </button>
  </PageHeader>

  <div class="mx-auto max-w-5xl space-y-6 px-4 pb-12 sm:px-6">
    <p v-if="loading" class="text-sm text-muted">Loading…</p>

    <template v-else-if="overview">
      <section aria-labelledby="content-heading">
        <h2 id="content-heading" class="sr-only">Content</h2>

        <ul class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <li v-for="collection in overview.collections" :key="collection.name">
            <RouterLink
              :to="{ name: 'collection', params: { collection: collection.name } }"
              class="card block p-4 transition hover:border-brand/35"
            >
              <p class="text-sm text-muted">{{ collection.label }}</p>
              <p class="mt-1 text-2xl font-semibold tabular-nums">{{ collection.total }}</p>
              <p class="mt-1 text-xs text-muted">
                {{ collection.published }} published<span v-if="collection.drafts">
                  · {{ collection.drafts }} draft</span
                >
              </p>
            </RouterLink>
          </li>

          <li>
            <RouterLink :to="{ name: 'media' }" class="card block p-4 transition hover:border-brand/35">
              <p class="text-sm text-muted">Media</p>
              <p class="mt-1 text-2xl font-semibold tabular-nums">{{ overview.media.files }}</p>
              <p class="mt-1 text-xs text-muted">{{ overview.media.readable }}</p>
            </RouterLink>
          </li>
        </ul>
      </section>

      <section class="card" aria-labelledby="recent-heading">
        <h2 id="recent-heading" class="border-b border-line px-4 py-3 text-sm font-semibold">
          Recently edited
        </h2>

        <p v-if="overview.recent.length === 0" class="px-4 py-6 text-sm text-muted">
          Nothing has been edited yet.
        </p>

        <ul v-else class="divide-y divide-line">
          <li v-for="item in overview.recent" :key="item.id">
            <RouterLink
              :to="{ name: 'entry', params: { collection: item.collection, id: item.id } }"
              class="flex items-center gap-3 px-4 py-2.5 transition hover:bg-canvas"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium">{{ item.title }}</span>
                <span class="block text-xs text-muted">{{ item.collectionLabel }}</span>
              </span>

              <span
                :class="[
                  'badge shrink-0',
                  item.status === 'published'
                    ? 'bg-success/10 text-success'
                    : 'bg-warning/10 text-warning',
                ]"
              >
                {{ item.status === "published" ? "Published" : "Draft" }}
              </span>

              <time
                :datetime="item.updatedAt"
                class="hidden w-28 shrink-0 text-right text-xs text-muted sm:block"
              >
                {{ relativeTime(item.updatedAt) }}
              </time>
            </RouterLink>
          </li>
        </ul>
      </section>

      <section class="card p-4" aria-labelledby="publishing-heading">
        <h2 id="publishing-heading" class="text-sm font-semibold">Publishing</h2>

        <dl class="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div class="flex justify-between gap-4 sm:block">
            <dt class="text-muted">Build webhook</dt>
            <dd>{{ overview.publisher.configured ? "Configured" : "Not configured" }}</dd>
          </div>
          <div class="flex justify-between gap-4 sm:block">
            <dt class="text-muted">Last successful build</dt>
            <dd>
              {{ overview.publisher.lastSuccessAt ? relativeTime(overview.publisher.lastSuccessAt) : "—" }}
            </dd>
          </div>
          <div v-if="overview.publisher.lastError" class="sm:col-span-2">
            <dt class="text-muted">Last error</dt>
            <dd class="text-danger">{{ overview.publisher.lastError }}</dd>
          </div>
        </dl>

        <p v-if="!overview.publisher.configured" class="mt-3 text-xs text-muted">
          Set BUILD_WEBHOOK_URL to have the website rebuilt automatically when content is published.
        </p>
      </section>
    </template>
  </div>
</template>
