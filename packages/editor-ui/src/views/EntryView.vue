<script setup lang="ts">
/**
 * Entry editor: the shared form (`useDocumentEditor`) and what an entry has
 * that settings do not. The ID names the entry's folder: changing it moves the
 * entry, the route follows, and the links to it can follow too. A new entry has
 * no ID yet, and an entry can be deleted. A new entry has a Create button; after
 * that it saves by itself, except a new ID, which waits for "Change ID".
 *
 * `embedded`: in the overlay form beside the live preview. It then changes no
 * address: a rename and a discard go to the overlay, and there is no delete.
 */

import { computed, onMounted, provide, ref, watch } from "vue";
import { useRouter } from "vue-router";

import { defaultValues, isValidId, pagePlaceholders, singleValue } from "@micacms/core/internal";

import { api, messageOf, type EntryDetail, type Referrer, type SavedEntry } from "@/api";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import DocumentStatus from "@/components/DocumentStatus.vue";
import FieldList from "@/components/fields/FieldList.vue";
import IssueSummary from "@/components/IssueSummary.vue";
import LocaleSwitcher from "@/components/LocaleSwitcher.vue";
import KeptChangesNotice from "@/components/KeptChangesNotice.vue";
import ModelNotice from "@/components/ModelNotice.vue";
import PageHeader from "@/components/PageHeader.vue";
import PageLink from "@/components/PageLink.vue";
import PreviewLink from "@/components/PreviewLink.vue";
import ReadOnlyNotice from "@/components/ReadOnlyNotice.vue";
import SaveConflict from "@/components/SaveConflict.vue";
import { useDocumentEditor } from "@/composables/useDocumentEditor";
import { provideFormLocale } from "@/composables/useFormLocale";
import { hasLocalizedFields } from "@/lib/locales";
import { usePreview } from "@/composables/usePreview";
import { usePreviewPage } from "@/composables/usePreviewPane";
import type { Edit } from "@/lib/edits";
import { formRootOf } from "@/lib/focus";
import { MEDIA_FOLDER } from "@/lib/media-folder";
import { movedPage as movedPageOf, pageHref } from "@/lib/pages";
import { useSchema } from "@/stores/schema";
import { useStaging } from "@/stores/staging";
import { useToast } from "@/stores/toast";

const props = defineProps<{ collection: string; id?: string; embedded?: boolean; focus?: string }>();
const emit = defineEmits<{ renamed: [id: string]; close: [] }>();

const router = useRouter();
const schema = useSchema();
const staging = useStaging();
const toast = useToast();

const definition = computed(() => schema.collection(props.collection));
// For a site with locales: the language that the form shows.
const { form: formLocale, reveal: revealLocale } = provideFormLocale(() => definition.value?.fields);
const localized = computed(() => hasLocalizedFields(definition.value?.fields ?? {}));
const updateLinks = ref(true);
const formElement = ref<HTMLFormElement | null>(null);

const doc = useDocumentEditor<EntryDetail, SavedEntry>({
  noun: "this entry",
  // ":new" is no valid ID, so it never names a saved entry.
  key: () => `${props.collection}/${props.id ?? ":new"}`,
  editKey: () => (props.id ? `entry:${props.collection}/${props.id}` : null),
  fields: () => definition.value?.fields,
  readOnly: () => !!definition.value?.readOnly,
  read: props.id ? () => api.entries.get(props.collection, props.id!) : null,
  values: (data) => data ?? defaultValues(definition.value?.fields ?? {}),
  write: (data, basis): Promise<SavedEntry> => {
    const payload = {
      data,
      revision: basis.revision,
      ...(basis.keepMine ? { keepMine: true } : {}),
      // Also before the list has loaded, or when it failed: the server finds the links itself.
      ...(idChanging.value && updateLinks.value ? { updateLinks: true } : {}),
    };
    return props.id ? api.entries.update(props.collection, props.id, payload) : api.entries.create(props.collection, payload);
  },
  saved: async (saved, auto) => {
    if (auto) return true;
    toast.success(
      saved.renamed ? `Saved as “${saved.id}”.` : "Saved.",
      saved.relinked > 0 ? `Updated the links in ${saved.relinked} other entr${saved.relinked === 1 ? "y or page" : "ies or pages"}.` : undefined,
    );
    // The server derives and de-duplicates the ID and can move the entry: open it at what it decided.
    if (saved.id === props.id) return true;
    if (props.embedded) {
      emit("renamed", saved.id);
      return false;
    }
    await router.replace({ name: "entry", params: { collection: props.collection, id: saved.id } });
    return false;
  },
  duplicate: "An entry with this ID exists already. Change the ID, then try again.",
  // A new ID moves the entry and can change links in other entries: it waits for "Change ID".
  heldField: (): string | null => (idChanging.value ? (definition.value?.idField ?? null) : null),
  root: () => formRootOf(formElement.value),
});
const { values, revision, loading, saving, busy, isNew, issues, failed, kept, pending, state } = doc;
const { state: conflict, theirs } = doc.conflict;

/** This entry was changed on the website while it has a draft here: Mica's own clone only. */
const websiteConflict = computed(() =>
  (staging.status.value?.sync?.conflicts ?? []).some(
    (item) =>
      item.target?.kind === "entry" && item.target.collection === props.collection && item.target.id === props.id,
  ),
);

/** An entry or settings page that links here, as the editor knows it: "Haus A (Projects)". */
function describeReferrer(item: Referrer): string {
  return item.kind === "entry" ? `${item.title} (${schema.collection(item.collection)?.label ?? item.collection})` : item.title;
}

/** The ID in the form, when it differs from the saved one: the links to this entry must follow. */
const newId = computed<string>(() => {
  const value = values.value[definition.value?.idField ?? ""];
  return typeof value === "string" ? value.trim() : "";
});
/** Also an empty ID: the server would make a new one from the title, so it waits for "Change ID" too. */
const idChanging = computed<boolean>(() => !!props.id && newId.value !== props.id);
const linkers = ref<Referrer[] | null>(null);
/** Where the page moves with the new ID, for a collection with a `url`: the old and the new address. */
const movedPage = computed(() =>
  movedPageOf(definition.value?.url, { id: props.id ?? "", data: saved.value }, { id: newId.value, data: values.value }),
);

// Uploads go into the entry's folder: the saved ID's, or for a new entry a valid ID in the form.
provide(
  MEDIA_FOLDER,
  computed(() => {
    if (props.id) return { path: `${props.collection}/${props.id}/media`, isNew: false };
    return isValidId(newId.value) ? { path: `${props.collection}/${newId.value}/media`, isNew: true } : null;
  }),
);

// The saved version opened again: the links start over.
watch(doc.version, () => {
  linkers.value = null;
  updateLinks.value = true;
});

watch(idChanging, async (changing) => {
  if (!changing || linkers.value !== null || !props.id) return;
  try {
    linkers.value = (await api.entries.references(props.collection, props.id)).references;
  } catch {
    // The notice is a courtesy; Publish refuses a broken link in any case.
    linkers.value = [];
  }
});

const devServer = usePreview();
/** The dev server's address with a page's path; none while the page has no address, such as an empty {activity}. */
const withAddress = (address: string, path: string | null): string | null => (path ? `${address}${path}` : null);
/** The saved data: the dev server shows it, not what the form holds before the next save. */
const saved = computed(() => doc.version.value?.data);
/** An address with other names than {id}, such as /{activity}/{id}: a draft of such a field moves the page. */
const addressNamesFields = computed(() => pagePlaceholders(definition.value?.url ?? "").some((name) => name !== "id"));
/** Its page in the dev server, which reads the saved drafts: also for one that was never published. */
const preview = computed(() =>
  props.id && devServer.address.value && definition.value?.url ? withAddress(devServer.address.value, pageHref(definition.value.url, props.id, saved.value)) : null,
);
// The overlay form shows a document of the main form's page: that page stays in the preview.
if (!props.embedded) usePreviewPage(preview, computed(() => !!props.id && !!definition.value?.url));

/**
 * Its page on the website: not for an entry that was never published, because
 * that page does not exist yet, and not while a draft can have moved it.
 */
const page = computed(() =>
  props.id && !(pending.value && (pending.value.state === "new" || addressNamesFields.value))
    ? pageHref(definition.value?.page, props.id, saved.value)
    : null,
);

const title = computed(() => {
  const def = definition.value;
  if (!def) return "Entry";
  const value = def.titleField ? singleValue(def.fields[def.titleField], values.value[def.titleField]) : undefined;
  if (typeof value === "string" && value.trim()) return value.trim();
  return isNew ? `New ${def.labelSingular.toLowerCase()}` : "Untitled";
});

/** The entry's folder, from the server, below the form. */
const location = computed(() => doc.version.value?.path ?? "");

onMounted(async () => {
  if (!definition.value) {
    loading.value = false;
    return;
  }
  if (await doc.open(props.embedded ? (props.focus ?? null) : undefined)) return;
  toast.error(doc.loadError.value ?? "Could not open this entry.");
  if (props.embedded) return emit("close");
  await router.replace({ name: "collection", params: { collection: props.collection } });
});

/** After a discard, a new entry is gone, and an ID change goes back to the old ID. */
async function discarded(edit: Edit): Promise<void> {
  if (props.embedded && edit.state === "new") {
    kept.forget();
    emit("close");
  } else if (props.embedded && edit.target?.kind === "entry" && edit.target.from) {
    kept.forget();
    emit("renamed", edit.target.from);
  } else if (edit.state === "new") {
    kept.forget();
    await router.replace({ name: "collection", params: { collection: props.collection } });
  } else if (edit.target?.kind === "entry" && edit.target.from) {
    kept.forget();
    await router.replace({ name: "entry", params: { collection: props.collection, id: edit.target.from } });
  } else {
    await doc.reopen();
  }
}

const confirmDelete = ref(false);
const references = ref<string[]>([]);

async function askDelete(): Promise<void> {
  references.value = [];
  if (props.id) {
    try {
      const { references: found } = await api.entries.references(props.collection, props.id);
      references.value = found.map(describeReferrer);
    } catch {
      // The warning is a courtesy; a failure to fetch it must not block deletion.
    }
  }
  confirmDelete.value = true;
}

async function remove(): Promise<void> {
  const id = props.id;
  const opened = revision.value;
  if (!id || !opened) return;
  try {
    // A colleague saved since: show their version, as for a save.
    const outcome = await doc.conflict.run(opened, () => api.entries.remove(props.collection, id, opened));
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

/** "Keep the old ID": the ID field goes back to the saved one. */
function keepId(): void {
  const field = definition.value?.idField;
  if (field && props.id) values.value = { ...values.value, [field]: props.id };
}

defineExpose({ atRisk: doc.atRisk });
</script>

<template>
  <template v-if="definition">
    <PageHeader
      :title="title"
      :loading="loading"
      :back="embedded ? null : { name: 'collection', params: { collection } }"
      :back-label="definition.label"
      :embedded="embedded"
      form
    >
      <template v-if="!definition.readOnly && !loading" #meta>
        <DocumentStatus :state="state" :edit="pending" @discarded="discarded" />
      </template>

      <PreviewLink v-if="preview && !embedded" :href="preview" />
      <PageLink v-if="page" :href="page" />
      <template v-if="!definition.readOnly">
        <button v-if="isNew" type="button" class="btn-primary" :disabled="saving" @click="doc.save()">
          {{ saving ? "Creating…" : "Create" }}
        </button>
        <button v-else-if="failed" type="button" class="btn-secondary" :disabled="saving" :title="failed" @click="doc.retry()">
          Try again
        </button>
        <RouterLink v-if="pending" :to="{ name: 'changes' }" class="btn-primary">Publish…</RouterLink>
      </template>

      <template v-if="formLocale && localized && !loading" #toolbar>
        <LocaleSwitcher :form="formLocale" :fields="definition.fields" :values="values" :issues="issues" />
      </template>
    </PageHeader>

    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <p v-if="loading" role="status" class="text-sm text-muted">Loading…</p>

      <template v-else>
        <ModelNotice v-if="!definition.readOnly" class="mb-5" />
        <ReadOnlyNotice v-if="definition.readOnly" :reason="definition.readOnly" />

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

        <div v-if="idChanging" role="status" class="mb-5 rounded-md border border-line bg-subtle p-4">
          <p v-if="newId" class="text-sm font-medium">The ID changes from “{{ id }}” to “{{ newId }}” when you choose Change ID</p>
          <p v-else class="text-sm font-medium">The ID is empty. Change ID makes a new one from the title</p>
          <p v-if="movedPage" class="mt-1 text-xs text-muted">The page moves from {{ movedPage.from }} to {{ movedPage.to }}.</p>
          <p class="mt-1 text-xs text-muted">Your other changes save as usual.</p>
          <template v-if="linkers?.length">
            <p class="mt-1 text-xs text-muted">
              {{ linkers.length }} other entr{{ linkers.length === 1 ? "y or page links" : "ies or pages link" }} to it:
              {{ linkers.map(describeReferrer).join(", ") }}.
            </p>
            <p v-if="linkers.some((item) => item.readOnly)" class="mt-1 text-xs font-medium text-warning">
              This version of Mica cannot change
              {{ linkers.filter((item) => item.readOnly).map(describeReferrer).join(", ") }}. Their links keep the old
              ID until a developer changes them.
            </p>
            <label class="mt-2 flex items-center gap-2 text-xs">
              <input v-model="updateLinks" type="checkbox" class="h-4 w-4" />
              Update their links when the ID changes
            </label>
            <p v-if="!updateLinks" class="mt-1 text-xs font-medium text-warning">
              Their links then point to an ID that does not exist, and Publish waits until they are changed.
            </p>
          </template>
          <p v-if="definition.url" class="mt-1 text-xs text-muted">
            Visitors who use the old URL, from a bookmark or a search engine, need a redirect. Ask the developer of
            the website for one.
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button type="button" class="btn-primary" :disabled="saving" @click="doc.save()">
              {{ saving ? "Saving…" : "Change ID" }}
            </button>
            <button type="button" class="btn-secondary" :disabled="saving" @click="keepId">Keep the old ID</button>
          </div>
        </div>

        <form ref="formElement" novalidate @reveal-field="revealLocale" @submit.prevent="isNew ? doc.save() : doc.autosave()" @focusout="doc.onLeave">
          <FieldList
            v-model="values"
            :fields="definition.fields"
            :issues="issues"
            :disabled="busy || !!definition.readOnly"
            :collection="collection"
            :entry-id="id"
          />

          <!-- Enter in a text input should save, not do nothing. -->
          <button v-if="!definition.readOnly" type="submit" class="sr-only">Save</button>
        </form>

        <div v-if="!isNew" class="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <p class="text-xs text-muted">Folder: <span class="font-mono">{{ location }}</span></p>
          <button v-if="!definition.readOnly && !embedded" type="button" class="btn-danger" @click="askDelete">
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
