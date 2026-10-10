<script setup lang="ts">
/**
 * Entry editor.
 *
 * One Save button, and Saved is not Published: a save lands in the site's
 * draft workspace and collects on the Publish page until somebody publishes
 * it. Unfinished work stays in this form and never reaches the server, which
 * is what the unsaved-changes guard is for.
 *
 * `revision` is how two editors stay out of each other's way. The form
 * remembers which version of the entry it opened and sends that token back with
 * the save. If someone else saved in the meantime the server answers 409, and
 * this view says so plainly rather than overwriting their work.
 *
 * An entry is addressed by its slug, so changing the slug field moves the entry
 * — files and all — and the route follows it.
 */

import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { defaultValues, type FieldIssue } from "@micacms/core";

import { api, ApiError, type EntryDetail } from "@/api";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import FieldList from "@/components/fields/FieldList.vue";
import PageHeader from "@/components/PageHeader.vue";
import { useUnsavedChanges } from "@/composables/useUnsavedChanges";
import { useSchema } from "@/stores/schema";
import { useStaging } from "@/stores/staging";
import { useToast } from "@/stores/toast";

const props = defineProps<{ collection: string; slug?: string }>();

const router = useRouter();
const schema = useSchema();
const staging = useStaging();
const toast = useToast();

const definition = computed(() => schema.collection(props.collection));

const entry = ref<EntryDetail | null>(null);
const values = ref<Record<string, unknown>>({});
const issues = ref<FieldIssue[]>([]);
const loading = ref(true);
const saving = ref(false);
const conflict = ref(false);
const confirmDelete = ref(false);
const references = ref<Array<{ collection: string; title: string }>>([]);

/**
 * The version this form was opened against.
 *
 * `null` on a new entry, which asserts to the server that nothing is there —
 * so two people creating the same slug is a conflict, not a silent overwrite.
 */
const revision = ref<string | null>(null);

const unsaved = useUnsavedChanges(values);
const dirty = unsaved.dirty;

const isNew = computed(() => !props.slug);

const title = computed(() => {
  const def = definition.value;
  if (!def) return "Entry";
  const value = values.value[def.titleField];
  if (typeof value === "string" && value.trim()) return value.trim();
  return isNew.value ? `New ${def.labelSingular.toLowerCase()}` : "Untitled";
});

/**
 * Where this entry lives in the repository — the path a reviewer will see.
 *
 * From the server, not assembled here: an entry with rich text or media is a
 * directory, and one without is a single `.json` file.
 */
const location = computed(() => entry.value?.path ?? "Not saved yet");

function setBaseline(detail: EntryDetail): void {
  entry.value = detail;
  values.value = structuredClone(detail.data);
  revision.value = detail.revision;
  issues.value = [];
  conflict.value = false;
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
});

async function save(): Promise<void> {
  saving.value = true;
  issues.value = [];

  const payload = { data: values.value, revision: revision.value };

  try {
    const saved = props.slug
      ? await api.entries.update(props.collection, props.slug, payload)
      : await api.entries.create(props.collection, payload);

    // The server owns the slug — it derives it, de-duplicates it, and may have
    // moved the entry. Re-open at whatever it decided rather than assuming.
    unsaved.markClean();
    toast.success(saved.renamed ? `Saved as “${saved.slug}”.` : "Saved.");
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
    if (error instanceof ApiError && error.status === 409) {
      // Nothing is lost: the form still holds the editor's work, and reloading
      // is a deliberate act rather than something that happens under them.
      conflict.value = true;
      toast.error("Someone else saved this entry while you were editing it.");
    } else if (error instanceof ApiError && error.issues.length > 0) {
      issues.value = error.issues;
      toast.error(error.message, `${error.issues.length} field(s) need attention.`);
      // Take the editor to the first problem rather than leaving them hunting.
      requestAnimationFrame(() => {
        document
          .querySelector('[aria-invalid="true"], .field-error')
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    } else {
      toast.error(error instanceof ApiError ? error.message : "Could not save this entry.");
    }
  } finally {
    saving.value = false;
  }
}

/** Takes the version now in the repository, discarding this form's edits. */
async function reload(): Promise<void> {
  if (!props.slug) return;
  try {
    await open(props.slug);
    toast.success("Reloaded from the repository.");
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not reload this entry.");
  }
}

async function askDelete(): Promise<void> {
  references.value = [];
  if (props.slug) {
    try {
      const { references: found } = await api.entries.references(props.collection, props.slug);
      references.value = found.map((item) => ({
        collection: schema.collection(item.collection)?.label ?? item.collection,
        title: item.title,
      }));
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
      :back="{ name: 'collection', params: { collection } }"
      :back-label="definition.label"
    >
      <span :class="['badge', dirty ? 'border-accent bg-accent-soft text-accent' : 'text-success']">
        <span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
        {{ dirty ? "Unsaved" : "Saved" }}
      </span>
      <button type="button" class="btn-primary" :disabled="saving || !dirty" @click="save">
        {{ saving ? "Saving…" : "Save changes" }}
      </button>
    </PageHeader>

    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <p v-if="loading" class="text-sm text-muted">Loading…</p>

      <template v-else>
        <div
          v-if="conflict"
          role="alert"
          class="mb-5 rounded-md border border-warning/15 bg-warning-soft p-4"
        >
          <p class="text-sm font-medium text-warning">This entry changed while you were editing</p>
          <p class="mt-1 text-xs text-muted">
            Your changes are still here and have not been saved. Copy anything you need, then load
            the current version — or open the repository to see what changed.
          </p>
          <button type="button" class="btn-secondary mt-2.5" @click="reload">
            Discard mine and reload
          </button>
        </div>

        <div
          v-if="issues.length"
          role="alert"
          class="mb-5 rounded-md border border-danger/15 bg-danger-soft p-4"
        >
          <p class="text-sm font-medium text-danger">
            {{ issues.length }} field{{ issues.length === 1 ? "" : "s" }} need attention
          </p>
          <ul class="mt-1.5 space-y-0.5 text-xs text-danger">
            <li v-for="issue in issues" :key="issue.path">{{ issue.message }}</li>
          </ul>
        </div>

        <form novalidate @submit.prevent="save">
          <FieldList
            v-model="values"
            :fields="definition.fields"
            :issues="issues"
            :disabled="saving"
            :collection="collection"
            :entry-slug="slug"
          />

          <!-- Enter in a text input should save, not do nothing. -->
          <button type="submit" class="sr-only">Save</button>
        </form>

        <div v-if="!isNew" class="mt-10 border-t border-line pt-5">
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
      <!-- Honest about what a delete is now: a pending change. It reaches the
           repository's history when the pending set is published, and the
           history keeps it from then on. -->
      <p>
        This removes <code>{{ location }}</code>. Like any edit, the removal joins the pending
        changes and reaches the repository when they are published.
      </p>

      <div v-if="references.length" class="mt-3 rounded-md border border-warning/15 bg-warning-soft p-4">
        <p class="text-sm font-medium text-warning">
          {{ references.length }} other entr{{ references.length === 1 ? "y" : "ies" }} link to this
          one:
        </p>
        <ul class="mt-1 list-inside list-disc text-xs">
          <li v-for="(item, index) in references" :key="index">
            {{ item.title }} ({{ item.collection }})
          </li>
        </ul>
      </div>
    </ConfirmDialog>
  </template>

  <div v-else class="p-8 text-center text-sm text-muted">
    There is no collection called "{{ collection }}".
  </div>
</template>
