<script setup lang="ts">
/**
 * Entry editor. Saved is not Published: a save joins the pending changes, and
 * unsaved work stays in the form. `revision` goes back with the save, so a
 * concurrent save gets a 409 instead of an overwrite. The slug is the address:
 * changing it moves the entry, and the route follows.
 */

import { computed, nextTick, onMounted, provide, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { defaultValues, isValidSlug } from "@micacms/core";

import { api, ApiError, type EntryDetail, type Referrer } from "@/api";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import FieldList from "@/components/fields/FieldList.vue";
import IssueSummary from "@/components/IssueSummary.vue";
import KeptChangesNotice from "@/components/KeptChangesNotice.vue";
import PageHeader from "@/components/PageHeader.vue";
import PendingNotice from "@/components/PendingNotice.vue";
import type { Edit } from "@/lib/edits";
import ReadOnlyNotice from "@/components/ReadOnlyNotice.vue";
import SaveConflict from "@/components/SaveConflict.vue";
import { fieldPathOf, useFormIssues } from "@/composables/useFormIssues";
import { useKeptChanges } from "@/composables/useKeptChanges";
import { useUnsavedChanges } from "@/composables/useUnsavedChanges";
import { focusField } from "@/lib/focus";
import { MEDIA_FOLDER } from "@/lib/media-folder";
import { useSchema } from "@/stores/schema";
import { useStaging } from "@/stores/staging";
import { useToast } from "@/stores/toast";

const props = defineProps<{ collection: string; slug?: string }>();

const route = useRoute();
const router = useRouter();
const schema = useSchema();
const staging = useStaging();
const toast = useToast();

const definition = computed(() => schema.collection(props.collection));

const entry = ref<EntryDetail | null>(null);
const values = ref<Record<string, unknown>>({});
const loading = ref(true);
const saving = ref(false);
/** A colleague saved since this form opened: their version, for the comparison. */
const conflict = ref<"none" | "loading" | "loaded" | "missing">("none");
const theirs = ref<EntryDetail | null>(null);
const confirmDelete = ref(false);

/** This entry was changed on the website while it has a draft here: Mica's own clone only. */
const websiteConflict = computed(() =>
  (staging.status.value?.sync?.conflicts ?? []).some(
    (item) =>
      item.target?.kind === "entry" && item.target.collection === props.collection && item.target.slug === props.slug,
  ),
);
const references = ref<string[]>([]);

/** An entry or settings page that links here, as the editor knows it: "Haus A (Projects)". */
function describeReferrer(item: Referrer): string {
  return item.kind === "entry" ? `${item.title} (${schema.collection(item.collection)?.label ?? item.collection})` : item.title;
}

/** The URL in the form, when it differs from the saved one: the links to this entry must follow. */
const newSlug = computed(() => {
  const value = values.value[definition.value?.slugField ?? ""];
  return typeof value === "string" ? value.trim() : "";
});
const urlChanging = computed(() => !!props.slug && newSlug.value !== "" && newSlug.value !== props.slug);
const linkers = ref<Referrer[] | null>(null);

// Uploads go into the entry's folder: the saved URL's, or for a new entry a valid URL in the form.
provide(
  MEDIA_FOLDER,
  computed(() => {
    if (props.slug) return { path: `${props.collection}/${props.slug}/media`, isNew: false };
    return isValidSlug(newSlug.value) ? { path: `${props.collection}/${newSlug.value}/media`, isNew: true } : null;
  }),
);
const updateLinks = ref(true);

watch(urlChanging, async (changing) => {
  if (!changing || linkers.value !== null || !props.slug) return;
  try {
    linkers.value = (await api.entries.references(props.collection, props.slug)).references;
  } catch {
    // The notice is a courtesy; Publish refuses a broken link in any case.
    linkers.value = [];
  }
});

/**
 * The version this form was opened against; `null` on a new entry, so a
 * duplicate slug is a conflict.
 */
const revision = ref<string | null>(null);

const form = useFormIssues(() => definition.value?.fields, values);
const issues = form.issues;

const unsaved = useUnsavedChanges(values);
const dirty = unsaved.dirty;
// Kept in this tab, so that signing in again after the session ended loses nothing.
// ":new" is no valid URL, so it never names a saved entry.
const kept = useKeptChanges(() => `${props.collection}/${props.slug ?? ":new"}`, values, revision, dirty);

const isNew = computed(() => !props.slug);

/** This entry's saved changes that are not on the website yet. */
const pending = computed(
  () => (props.slug && staging.edits.value.find((edit) => edit.key === `entry:${props.collection}/${props.slug}`)) || null,
);

const state = computed(() =>
  isNew.value
    ? { label: "Not saved yet", tone: "border-accent bg-accent-soft text-accent" }
    : dirty.value
      ? { label: "Unsaved changes", tone: "border-accent bg-accent-soft text-accent" }
      : pending.value
        ? { label: "Saved · not published", tone: "text-warning" }
        : staging.knowsPublished.value
          ? { label: "Published", tone: "text-success" }
          : { label: "Saved", tone: "text-muted" },
);

const title = computed(() => {
  const def = definition.value;
  if (!def) return "Entry";
  const value = values.value[def.titleField];
  if (typeof value === "string" && value.trim()) return value.trim();
  return isNew.value ? `New ${def.labelSingular.toLowerCase()}` : "Untitled";
});

/**
 * Where this entry lives, from the server: a directory with rich text or media,
 * else one `.json` file.
 */
const location = computed(() => entry.value?.path ?? "Not saved yet");

function setBaseline(detail: EntryDetail): void {
  entry.value = detail;
  values.value = structuredClone(detail.data);
  revision.value = detail.revision;
  form.reset();
  conflict.value = "none";
  theirs.value = null;
  linkers.value = null;
  updateLinks.value = true;
  unsaved.markClean();
}

async function open(slug: string): Promise<void> {
  setBaseline(await api.entries.get(props.collection, slug));
}

onMounted(async () => {
  const def = definition.value;
  if (!def) {
    loading.value = false;
    return;
  }

  try {
    if (props.slug) {
      await open(props.slug);
    } else {
      // A fresh entry starts as a full skeleton so every input is bound. The
      // skeleton itself is not an edit, so it becomes the baseline.
      values.value = defaultValues(def.fields);
      revision.value = null;
      unsaved.markClean();
    }
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not open this entry.");
    await router.replace({ name: "collection", params: { collection: props.collection } });
  } finally {
    loading.value = false;
  }
  kept.check();

  // From a problem on the Publish page: go to its field.
  if (typeof route.query.field === "string") {
    const field = route.query.field;
    await nextTick();
    focusField(field);
  }
});

/** Checks a field when the editor leaves it. */
function onLeave(event: FocusEvent): void {
  const path = fieldPathOf(event.target);
  if (path) form.leave(path);
}

/** Shows the problems and moves to the first one. */
async function showIssues(): Promise<void> {
  await nextTick();
  if (issues.value[0]) focusField(issues.value[0].path);
}

/** `keepMine`: save over the colleague's version that the conflict showed. */
async function save(options: { keepMine?: boolean } = {}): Promise<void> {
  // Enter in a read-only field still submits the form while a save runs.
  if (definition.value?.readOnly || saving.value) return;
  if (!form.checkAll()) {
    toast.error("Some fields need attention before you can save.");
    await showIssues();
    return;
  }
  saving.value = true;

  const keepMine = options.keepMine === true && theirs.value !== null;
  const payload = {
    data: values.value,
    revision: keepMine ? theirs.value!.revision : revision.value,
    ...(keepMine ? { keepMine } : {}),
    // Also before the list has loaded, or when it failed: the server finds the links itself.
    ...(urlChanging.value && updateLinks.value ? { updateLinks: true } : {}),
  };

  try {
    const saved = props.slug
      ? await api.entries.update(props.collection, props.slug, payload)
      : await api.entries.create(props.collection, payload);

    // The server derives and de-duplicates the slug and can move the entry:
    // re-open at what it decided.
    unsaved.markClean();
    kept.forget();
    toast.success(
      saved.renamed ? `Saved as “${saved.slug}”.` : "Saved.",
      saved.relinked > 0 ? `Updated the links in ${saved.relinked} other entr${saved.relinked === 1 ? "y or page" : "ies or pages"}.` : undefined,
    );
    void staging.refresh();

    if (saved.slug !== props.slug) {
      await router.replace({
        name: "entry",
        params: { collection: props.collection, slug: saved.slug },
      });
      return;
    }

    await open(saved.slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && !props.slug) {
      toast.error("An entry with this URL exists already. Change the URL, then save.");
    } else if (error instanceof ApiError && error.status === 409) {
      // The form keeps the editor's work; which version stays is their decision.
      await showConflict(props.slug!, error.message);
    } else if (error instanceof ApiError && error.issues.length > 0) {
      form.set(error.issues);
      toast.error(error.message, `${error.issues.length} field(s) need attention.`);
      await showIssues();
    } else {
      toast.error(error instanceof ApiError ? error.message : "Could not save this entry.");
    }
  } finally {
    saving.value = false;
  }
}

async function showConflict(slug: string, message: string): Promise<void> {
  conflict.value = "loading";
  try {
    theirs.value = await api.entries.get(props.collection, slug);
    conflict.value = "loaded";
    // This entry is as it was: what changed is an entry or page whose links were to follow.
    if (theirs.value.revision === revision.value) {
      conflict.value = "none";
      theirs.value = null;
      toast.error(message);
    }
  } catch {
    theirs.value = null;
    conflict.value = "missing";
  }
}

/** Takes the colleague's saved version, discarding this form's edits. */
async function useTheirs(): Promise<void> {
  if (!props.slug) return;
  try {
    await open(props.slug);
    kept.forget();
    toast.success("Loaded their version.");
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not load this entry.");
  }
}

/** After a discard, a new entry is gone, and a URL change goes back to the old URL. */
async function discarded(edit: Edit): Promise<void> {
  kept.forget();
  if (edit.state === "new") {
    await router.replace({ name: "collection", params: { collection: props.collection } });
  } else if (edit.target?.kind === "entry" && edit.target.from) {
    await router.replace({ name: "entry", params: { collection: props.collection, slug: edit.target.from } });
  } else if (props.slug) {
    await open(props.slug);
  }
}

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
  if (!props.slug) return;
  try {
    await api.entries.remove(props.collection, props.slug);
    unsaved.release();
    toast.success("Deleted.");
    void staging.refresh();
    await router.replace({ name: "collection", params: { collection: props.collection } });
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not delete this entry.");
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
      <template v-if="!definition.readOnly">
        <span :class="['badge', state.tone]">
          <span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
          {{ state.label }}
        </span>
        <button type="button" class="btn-primary" :disabled="saving || !dirty" @click="save()">
          {{ saving ? "Saving…" : "Save changes" }}
        </button>
      </template>
    </PageHeader>

    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <p v-if="loading" role="status" class="text-sm text-muted">Loading…</p>

      <template v-else>
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
          @keep="save({ keepMine: true })"
          @take="useTheirs"
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
            <p v-if="linkers.some((item) => item.readOnly)" class="mt-1 text-xs text-warning">
              This version of Mica cannot change
              {{ linkers.filter((item) => item.readOnly).map(describeReferrer).join(", ") }}. Their links keep the old
              URL until a developer changes them.
            </p>
            <label class="mt-2 flex items-center gap-2 text-xs">
              <input v-model="updateLinks" type="checkbox" class="h-4 w-4" />
              Update their links when I save
            </label>
            <p v-if="!updateLinks" class="mt-1 text-xs text-warning">
              Their links then point to a URL that does not exist, and Publish waits until they are changed.
            </p>
          </template>
          <p class="mt-1 text-xs text-muted">
            Visitors who use the old URL, from a bookmark or a search engine, need a redirect. Ask the developer of
            the website for one.
          </p>
        </div>

        <form novalidate @submit.prevent="save()" @focusout="onLeave">
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
