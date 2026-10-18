<script setup lang="ts">
/**
 * Singleton editor: the shared form (`useDocumentEditor`) without the parts
 * that need a slug (no rename, no delete, no list).
 */

import { computed, onMounted, provide } from "vue";

import { withEmptyValues } from "@micacms/core/internal";

import { api, type SingletonDetail } from "@/api";
import FieldList from "@/components/fields/FieldList.vue";
import IssueSummary from "@/components/IssueSummary.vue";
import KeptChangesNotice from "@/components/KeptChangesNotice.vue";
import ModelNotice from "@/components/ModelNotice.vue";
import PageHeader from "@/components/PageHeader.vue";
import PageLink from "@/components/PageLink.vue";
import PendingNotice from "@/components/PendingNotice.vue";
import PreviewLink from "@/components/PreviewLink.vue";
import ReadOnlyNotice from "@/components/ReadOnlyNotice.vue";
import SaveConflict from "@/components/SaveConflict.vue";
import StatusNotice from "@/components/StatusNotice.vue";
import { useDocumentEditor } from "@/composables/useDocumentEditor";
import { usePreview } from "@/composables/usePreview";
import { MEDIA_FOLDER } from "@/lib/media-folder";
import { pageHref } from "@/lib/pages";
import { useSchema } from "@/stores/schema";
import { useStaging } from "@/stores/staging";
import { useToast } from "@/stores/toast";

const props = defineProps<{ name: string }>();

// Settings keep their media in their own folder, as an entry does.
provide(
  MEDIA_FOLDER,
  computed(() => ({ path: `${props.name}/media`, isNew: false })),
);

const schema = useSchema();
const staging = useStaging();
const toast = useToast();

const definition = computed(() => schema.singleton(props.name));
const page = computed(() => pageHref(definition.value?.page));
const devServer = usePreview();
const preview = computed(() => (devServer.address.value && definition.value?.url ? `${devServer.address.value}${definition.value.url}` : null));

const doc = useDocumentEditor<SingletonDetail, { revision: string }>({
  noun: "these settings",
  key: () => `singleton:${props.name}`,
  editKey: () => `singleton:${props.name}`,
  fields: () => definition.value?.fields,
  readOnly: () => !!definition.value?.readOnly,
  read: () => api.singletons.get(props.name),
  // A field added to the model since the file was written opens empty.
  values: (data) => withEmptyValues(definition.value?.fields ?? {}, data ?? {}),
  write: (data, basis) => api.singletons.save(props.name, data, basis.revision, basis.keepMine),
  saved: async () => {
    toast.success("Settings saved.");
    return true;
  },
});
const { values, loading, loadError, saving, issues, dirty, kept, pending, state } = doc;
const { state: conflict, theirs } = doc.conflict;

/**
 * These settings were changed on the website while they have a draft here:
 * Mica's own clone only.
 */
const websiteConflict = computed(() =>
  (staging.status.value?.sync?.conflicts ?? []).some(
    (item) => item.target?.kind === "singleton" && item.target.name === props.name,
  ),
);

/** Where these settings live, as the server reports it. */
const location = computed(() => doc.version.value?.path ?? "");

onMounted(doc.open);
</script>

<template>
  <template v-if="definition">
    <PageHeader :title="definition.label" :subtitle="location" :loading="loading">
      <PreviewLink v-if="preview" :href="preview" />
      <PageLink v-if="page" :href="page" />
      <template v-if="!definition.readOnly && !loadError">
        <span :class="['status', state.tone]">
          {{ state.label }}
        </span>
        <button type="button" class="btn-primary" :disabled="saving || !dirty" @click="doc.save()">
          {{ saving ? "Saving…" : "Save changes" }}
        </button>
      </template>
    </PageHeader>

    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <StatusNotice v-if="loading" kind="loading" />

      <StatusNotice v-else-if="loadError" kind="error" title="These settings could not be loaded" :message="loadError" @retry="doc.load" />

      <template v-else>
        <p v-if="definition.description" class="mb-5 text-sm text-muted">
          {{ definition.description }}
        </p>

        <ModelNotice v-if="!definition.readOnly" class="mb-5" />
        <ReadOnlyNotice v-if="definition.readOnly" :reason="definition.readOnly" />
        <PendingNotice v-else-if="pending && !dirty" :edit="pending" @discarded="doc.reopen()" />

        <div
          v-if="websiteConflict"
          role="alert"
          class="mb-5 rounded-md border border-warning/15 bg-warning-soft p-4"
        >
          <p class="text-sm font-medium text-warning">These settings were changed on the website while you edited</p>
          <p class="mt-1 text-xs text-muted">
            Your saved version is kept. Choose which version to publish on the Publish page.
          </p>
          <RouterLink :to="{ name: 'changes' }" class="btn-secondary mt-2.5 inline-flex">Choose a version</RouterLink>
        </div>

        <SaveConflict
          v-if="conflict !== 'none'"
          :state="conflict"
          :theirs="theirs?.data ?? null"
          :mine="values"
          :fields="definition.fields"
          :busy="saving"
          @keep="doc.save({ keepMine: true })"
          @take="doc.reopen('Loaded their version.')"
        />

        <KeptChangesNotice v-if="kept.offered.value" :at="kept.offered.value.at" @restore="kept.restore()" @forget="kept.forget()" />
        <IssueSummary :issues="issues" />

        <form novalidate @submit.prevent="doc.save()" @focusout="doc.onLeave">
          <FieldList
            v-model="values"
            :fields="definition.fields"
            :issues="issues"
            :disabled="saving || !!definition.readOnly"
          />
          <button v-if="!definition.readOnly" type="submit" class="sr-only">Save</button>
        </form>
      </template>
    </div>
  </template>

  <div v-else class="p-8 text-center text-sm text-muted">
    There are no settings called "{{ name }}".
  </div>
</template>
