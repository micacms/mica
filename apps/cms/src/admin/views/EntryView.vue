<script setup lang="ts">
/**
 * Entry editor (§10).
 *
 * Save draft and Publish are separate actions: a draft save is lenient so
 * unfinished work is never lost, publishing validates strictly. Unsaved changes
 * are guarded on navigation and on tab close.
 */

import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";

import { defaultValues, type EntryStatus, type FieldIssue } from "@micacms/model";

import { api, ApiError, type EntryDetail } from "@/api";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import FieldList from "@/components/fields/FieldList.vue";
import PageHeader from "@/components/PageHeader.vue";
import RevisionPanel from "@/components/RevisionPanel.vue";
import { provideMediaRegistry } from "@/composables/mediaRegistry";
import { useUnsavedChanges } from "@/composables/useUnsavedChanges";
import { absoluteTime } from "@/lib/format";
import { useSchema } from "@/stores/schema";
import { useToast } from "@/stores/toast";

const props = defineProps<{ collection: string; id?: string }>();

const router = useRouter();
const schema = useSchema();
const toast = useToast();
const registry = provideMediaRegistry();

const definition = computed(() => schema.collection(props.collection));

const entry = ref<EntryDetail | null>(null);
const values = ref<Record<string, unknown>>({});
const issues = ref<FieldIssue[]>([]);
const loading = ref(true);
const saving = ref(false);
const showRevisions = ref(false);
const confirmDelete = ref(false);
const references = ref<Array<{ collection: string; title: string }>>([]);

const unsaved = useUnsavedChanges(values);

const isNew = computed(() => !props.id);
const status = computed<EntryStatus>(() => entry.value?.status ?? "draft");

const title = computed(() => {
  const def = definition.value;
  if (!def) return "Entry";
  const value = values.value[def.titleField];
  if (typeof value === "string" && value.trim()) return value.trim();
  return isNew.value ? `New ${def.labelSingular.toLowerCase()}` : "Untitled";
});

function setBaseline(detail: EntryDetail): void {
  entry.value = detail;
  values.value = structuredClone(detail.raw);
  registry.add(detail.media);
  issues.value = [];
  unsaved.markClean();
}

onMounted(async () => {
  const def = definition.value;
  if (!def) {
    loading.value = false;
    return;
  }

  try {
    if (props.id) {
      setBaseline(await api.entries.get(props.id));
    } else {
      // A fresh entry starts as a full skeleton so every input is bound. The
      // skeleton itself is not an edit, so it becomes the baseline.
      values.value = defaultValues(def.fields);
      unsaved.markClean();
    }
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not open this entry.");
    await router.replace({ name: "collection", params: { collection: props.collection } });
  } finally {
    loading.value = false;
  }
});

async function save(nextStatus?: EntryStatus): Promise<void> {
  saving.value = true;
  issues.value = [];

  const payload = { data: values.value, status: nextStatus ?? status.value };

  try {
    const saved = props.id
      ? await api.entries.update(props.id, payload)
      : await api.entries.create(props.collection, payload);

    setBaseline(saved);

    toast.success(
      nextStatus === "published"
        ? "Published."
        : nextStatus === "draft" && status.value === "published"
          ? "Moved back to draft."
          : "Saved.",
    );

    if (!props.id) {
      await router.replace({
        name: "entry",
        params: { collection: props.collection, id: saved.id },
      });
    }
  } catch (error) {
    if (error instanceof ApiError && error.issues.length > 0) {
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

async function askDelete(): Promise<void> {
  references.value = [];
  if (props.id) {
    try {
      const { references: found } = await api.entries.references(props.id);
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
  if (!props.id) return;
  try {
    await api.entries.remove(props.id);
    unsaved.release();
    toast.success("Deleted.");
    await router.replace({ name: "collection", params: { collection: props.collection } });
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not delete this entry.");
  } finally {
    confirmDelete.value = false;
  }
}

async function onRestored(restored: EntryDetail): Promise<void> {
  setBaseline(restored);
  showRevisions.value = false;
  toast.success("Revision restored.");
}
</script>

<template>
  <template v-if="definition">
    <PageHeader
      :title="title"
      :subtitle="entry ? `Last saved ${absoluteTime(entry.updatedAt)}` : 'Not saved yet'"
      :back="{ name: 'collection', params: { collection } }"
      :back-label="definition.label"
    >
      <span
        v-if="!isNew"
        :class="[
          'badge mr-1',
          status === 'published'
            ? 'bg-success/10 text-success'
            : 'bg-warning/10 text-warning',
        ]"
      >
        {{ status === "published" ? "Published" : "Draft" }}
      </span>

      <button
        v-if="!isNew"
        type="button"
        class="btn-ghost"
        @click="showRevisions = true"
      >
        History
      </button>

      <button type="button" class="btn-secondary" :disabled="saving" @click="save('draft')">
        {{ status === "published" ? "Unpublish" : "Save draft" }}
      </button>

      <button type="button" class="btn-primary" :disabled="saving" @click="save('published')">
        {{ saving ? "Saving…" : status === "published" ? "Save & publish" : "Publish" }}
      </button>
    </PageHeader>

    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <p v-if="loading" class="text-sm text-muted">Loading…</p>

      <template v-else>
        <div
          v-if="issues.length"
          role="alert"
          class="mb-5 rounded-lg border border-danger/25 bg-danger/5 p-3.5"
        >
          <p class="text-sm font-medium text-danger">
            {{ issues.length }} field{{ issues.length === 1 ? "" : "s" }} need attention
          </p>
          <ul class="mt-1.5 space-y-0.5 text-xs text-danger">
            <li v-for="issue in issues" :key="issue.path">{{ issue.message }}</li>
          </ul>
        </div>

        <form novalidate @submit.prevent="save()">
          <FieldList
            v-model="values"
            :fields="definition.fields"
            :issues="issues"
            :disabled="saving"
            :collection="collection"
            :entry-id="id"
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

    <RevisionPanel
      v-if="id"
      :open="showRevisions"
      target="entry"
      :entry-id="id"
      @close="showRevisions = false"
      @restored="onRestored"
    />

    <ConfirmDialog
      :open="confirmDelete"
      :title="`Delete “${title}”?`"
      confirm-label="Delete"
      destructive
      @cancel="confirmDelete = false"
      @confirm="remove"
    >
      <p>This cannot be undone. The entry and its history will be removed.</p>

      <div v-if="references.length" class="mt-3 rounded-lg bg-warning/10 p-3">
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
