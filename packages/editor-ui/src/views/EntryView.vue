<script setup lang="ts">
/**
 * Entry editor: the shared form (`useDocumentEditor`) and what an entry has
 * that settings do not. The slug is the address: changing it moves the entry,
 * the route follows, and the links to it can follow too. A new entry has no
 * slug yet, and an entry can be deleted.
 */

import { computed, onMounted, provide, ref, watch } from "vue";
import { useRouter } from "vue-router";

import { defaultValues, isValidSlug } from "@micacms/core/internal";

import { api, messageOf, type EntryDetail, type Referrer, type SavedEntry } from "@/api";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
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
import { useDocumentEditor } from "@/composables/useDocumentEditor";
import { usePreview } from "@/composables/usePreview";
import type { Edit } from "@/lib/edits";
import { MEDIA_FOLDER } from "@/lib/media-folder";
import { pageHref } from "@/lib/pages";
import { useSchema } from "@/stores/schema";
import { useStaging } from "@/stores/staging";
import { useToast } from "@/stores/toast";

const props = defineProps<{ collection: string; slug?: string }>();

const router = useRouter();
const schema = useSchema();
const staging = useStaging();
const toast = useToast();

const definition = computed(() => schema.collection(props.collection));
const updateLinks = ref(true);

const doc = useDocumentEditor<EntryDetail, SavedEntry>({
  noun: "this entry",
  // ":new" is no valid URL, so it never names a saved entry.
  key: () => `${props.collection}/${props.slug ?? ":new"}`,
  editKey: () => (props.slug ? `entry:${props.collection}/${props.slug}` : null),
  fields: () => definition.value?.fields,
  readOnly: () => !!definition.value?.readOnly,
  read: props.slug ? () => api.entries.get(props.collection, props.slug!) : null,
  values: (data) => data ?? defaultValues(definition.value?.fields ?? {}),
  write: (data, basis): Promise<SavedEntry> => {
    const payload = {
      data,
      revision: basis.revision,
      ...(basis.keepMine ? { keepMine: true } : {}),
      // Also before the list has loaded, or when it failed: the server finds the links itself.
      ...(urlChanging.value && updateLinks.value ? { updateLinks: true } : {}),
    };
    return props.slug ? api.entries.update(props.collection, props.slug, payload) : api.entries.create(props.collection, payload);
  },
  saved: async (saved) => {
    toast.success(
      saved.renamed ? `Saved as “${saved.slug}”.` : "Saved.",
      saved.relinked > 0 ? `Updated the links in ${saved.relinked} other entr${saved.relinked === 1 ? "y or page" : "ies or pages"}.` : undefined,
    );
    // The server derives and de-duplicates the slug and can move the entry: open it at what it decided.
    if (saved.slug === props.slug) return true;
    await router.replace({ name: "entry", params: { collection: props.collection, slug: saved.slug } });
    return false;
  },
  duplicate: "An entry with this URL exists already. Change the URL, then save.",
});
const { values, revision, loading, saving, isNew, issues, dirty, kept, pending, state } = doc;
const { state: conflict, theirs } = doc.conflict;

/** This entry was changed on the website while it has a draft here: Mica's own clone only. */
const websiteConflict = computed(() =>
  (staging.status.value?.sync?.conflicts ?? []).some(
    (item) =>
      item.target?.kind === "entry" && item.target.collection === props.collection && item.target.slug === props.slug,
  ),
);

/** An entry or settings page that links here, as the editor knows it: "Haus A (Projects)". */
function describeReferrer(item: Referrer): string {
  return item.kind === "entry" ? `${item.title} (${schema.collection(item.collection)?.label ?? item.collection})` : item.title;
}

/** The URL in the form, when it differs from the saved one: the links to this entry must follow. */
const newSlug = computed<string>(() => {
  const value = values.value[definition.value?.slugField ?? ""];
  return typeof value === "string" ? value.trim() : "";
});
const urlChanging = computed<boolean>(() => !!props.slug && newSlug.value !== "" && newSlug.value !== props.slug);
const linkers = ref<Referrer[] | null>(null);

// Uploads go into the entry's folder: the saved URL's, or for a new entry a valid URL in the form.
provide(
  MEDIA_FOLDER,
  computed(() => {
    if (props.slug) return { path: `${props.collection}/${props.slug}/media`, isNew: false };
    return isValidSlug(newSlug.value) ? { path: `${props.collection}/${newSlug.value}/media`, isNew: true } : null;
  }),
);

// The saved version opened again: the links start over.
watch(doc.version, () => {
  linkers.value = null;
  updateLinks.value = true;
});

watch(urlChanging, async (changing) => {
  if (!changing || linkers.value !== null || !props.slug) return;
  try {
    linkers.value = (await api.entries.references(props.collection, props.slug)).references;
  } catch {
    // The notice is a courtesy; Publish refuses a broken link in any case.
    linkers.value = [];
  }
});

const devServer = usePreview();
/** Its page in the dev server, which reads the saved drafts: also for one that was never published. */
const preview = computed(() =>
  props.slug && devServer.address.value && definition.value?.url ? `${devServer.address.value}${pageHref(definition.value.url, props.slug)}` : null,
);

/** Its page on the website: not for an entry that was never published, because that page does not exist yet. */
const page = computed(() => (props.slug && pending.value?.state !== "new" ? pageHref(definition.value?.page, props.slug) : null));

const title = computed(() => {
  const def = definition.value;
  if (!def) return "Entry";
  const value = def.titleField ? values.value[def.titleField] : undefined;
  if (typeof value === "string" && value.trim()) return value.trim();
  return isNew ? `New ${def.labelSingular.toLowerCase()}` : "Untitled";
});

/** The entry's folder, from the server. */
const location = computed(() => doc.version.value?.path ?? "Not saved yet");

onMounted(async () => {
  if (!definition.value) {
    loading.value = false;
    return;
  }
  if (await doc.open()) return;
  toast.error(doc.loadError.value ?? "Could not open this entry.");
  await router.replace({ name: "collection", params: { collection: props.collection } });
});

/** After a discard, a new entry is gone, and a URL change goes back to the old URL. */
async function discarded(edit: Edit): Promise<void> {
  if (edit.state === "new") {
    kept.forget();
    await router.replace({ name: "collection", params: { collection: props.collection } });
  } else if (edit.target?.kind === "entry" && edit.target.from) {
    kept.forget();
    await router.replace({ name: "entry", params: { collection: props.collection, slug: edit.target.from } });
  } else {
    await doc.reopen();
  }
}

const confirmDelete = ref(false);
const references = ref<string[]>([]);

async function askDelete(): Promise<void> {
  references.value = [];
  if (props.slug) {
    try {
      const { references: found } = await api.entries.references(props.collection, props.slug);
      references.value = found.map(describeReferrer);
    } catch {
      // The warning is a courtesy; a failure to fetch it must not block deletion.
    }
  }
  confirmDelete.value = true;
}

async function remove(): Promise<void> {
  const slug = props.slug;
  const opened = revision.value;
  if (!slug || !opened) return;
  try {
    // A colleague saved since: show their version, as for a save.
    const outcome = await doc.conflict.run(opened, () => api.entries.remove(props.collection, slug, opened));
    if (outcome.kind === "refused") toast.error(outcome.message);
    if (outcome.kind !== "done") return;
    doc.unsaved.release();
    toast.success("Deleted.");
    void staging.refresh();
    await router.replace({ name: "collection", params: { collection: props.collection } });
  } catch (error) {
    toast.error(messageOf(error, "Could not delete this entry."));
  } finally {
    confirmDelete.value = false;
  }
}
</script>

<template>
  <template v-if="definition">
    <PageHeader
      :title="title"
      :subtitle="location"
      :loading="loading"
      :back="{ name: 'collection', params: { collection } }"
      :back-label="definition.label"
    >
      <PreviewLink v-if="preview" :href="preview" />
      <PageLink v-if="page" :href="page" />
      <template v-if="!definition.readOnly">
        <span :class="['status', state.tone]">
          {{ state.label }}
        </span>
        <button type="button" class="btn-primary" :disabled="saving || !dirty" @click="doc.save()">
          {{ saving ? "Saving…" : "Save changes" }}
        </button>
      </template>
    </PageHeader>

    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <p v-if="loading" role="status" class="text-sm text-muted">Loading…</p>

      <template v-else>
        <ModelNotice v-if="!definition.readOnly" class="mb-5" />
        <ReadOnlyNotice v-if="definition.readOnly" :reason="definition.readOnly" />
        <PendingNotice v-else-if="pending && !dirty" :edit="pending" @discarded="discarded" />

        <div
          v-if="websiteConflict"
          role="alert"
          class="mb-5 rounded-md border border-warning/15 bg-warning-soft p-4"
        >
          <p class="text-sm font-medium text-warning">This entry was changed on the website while you edited</p>
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

        <div v-if="urlChanging" role="status" class="mb-5 rounded-md border border-line bg-subtle p-4">
          <p class="text-sm font-medium">The URL changes from “{{ slug }}” to “{{ newSlug }}” when you save</p>
          <template v-if="linkers?.length">
            <p class="mt-1 text-xs text-muted">
              {{ linkers.length }} other entr{{ linkers.length === 1 ? "y or page links" : "ies or pages link" }} to it:
              {{ linkers.map(describeReferrer).join(", ") }}.
            </p>
            <p v-if="linkers.some((item) => item.readOnly)" class="mt-1 text-xs font-medium text-warning">
              This version of Mica cannot change
              {{ linkers.filter((item) => item.readOnly).map(describeReferrer).join(", ") }}. Their links keep the old
              URL until a developer changes them.
            </p>
            <label class="mt-2 flex items-center gap-2 text-xs">
              <input v-model="updateLinks" type="checkbox" class="h-4 w-4" />
              Update their links when I save
            </label>
            <p v-if="!updateLinks" class="mt-1 text-xs font-medium text-warning">
              Their links then point to a URL that does not exist, and Publish waits until they are changed.
            </p>
          </template>
          <p class="mt-1 text-xs text-muted">
            Visitors who use the old URL, from a bookmark or a search engine, need a redirect. Ask the developer of
            the website for one.
          </p>
        </div>

        <form novalidate @submit.prevent="doc.save()" @focusout="doc.onLeave">
          <FieldList
            v-model="values"
            :fields="definition.fields"
            :issues="issues"
            :disabled="saving || !!definition.readOnly"
            :collection="collection"
            :entry-slug="slug"
          />

          <!-- Enter in a text input should save, not do nothing. -->
          <button v-if="!definition.readOnly" type="submit" class="sr-only">Save</button>
        </form>

        <div v-if="!isNew && !definition.readOnly" class="mt-10 border-t border-line pt-5">
          <button type="button" class="btn-danger" @click="askDelete">
            Delete this {{ definition.labelSingular.toLowerCase() }}
          </button>
        </div>
      </template>
    </div>

    <ConfirmDialog
      :open="confirmDelete"
      :title="`Delete “${title}”?`"
      confirm-label="Delete"
      destructive
      @cancel="confirmDelete = false"
      @confirm="remove"
    >
      <p>
        Like any change, the removal is saved first, and the entry leaves the website when you
        publish.
      </p>

      <div v-if="references.length" class="mt-3 rounded-md border border-warning/15 bg-warning-soft p-4">
        <p class="text-sm font-medium text-warning">
          {{ references.length }} other entr{{ references.length === 1 ? "y or page links" : "ies or pages link" }} to
          this one:
        </p>
        <ul class="mt-1 list-inside list-disc text-xs">
          <li v-for="(item, index) in references" :key="index">{{ item }}</li>
        </ul>
      </div>
    </ConfirmDialog>
  </template>

  <div v-else class="p-8 text-center text-sm text-muted">
    There is no collection called "{{ collection }}".
  </div>
</template>
