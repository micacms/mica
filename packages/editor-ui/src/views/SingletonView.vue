<script setup lang="ts">
/**
 * Singleton editor: the entry editor without the parts that need a slug (no
 * rename, no delete, no list). `revision` goes back with the save, so a second
 * editor cannot be overwritten in silence.
 */

import { computed, nextTick, onMounted, provide, ref, watch } from "vue";
import { useRoute } from "vue-router";

import { withDefaults as fillDefaults } from "@micacms/core";

import { api, ApiError, type SingletonDetail } from "@/api";
import FieldList from "@/components/fields/FieldList.vue";
import IssueSummary from "@/components/IssueSummary.vue";
import KeptChangesNotice from "@/components/KeptChangesNotice.vue";
import PageHeader from "@/components/PageHeader.vue";
import PendingNotice from "@/components/PendingNotice.vue";
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

const props = defineProps<{ name: string }>();
const route = useRoute();

// Settings with media keep them in their own folder, as an entry does.
provide(
  MEDIA_FOLDER,
  computed(() => ({ path: `${props.name}/media`, isNew: false })),
);

const schema = useSchema();
const staging = useStaging();
const toast = useToast();

const definition = computed(() => schema.singleton(props.name));

const values = ref<Record<string, unknown>>({});
const revision = ref<string | null>(null);
const loading = ref(true);
const saving = ref(false);
/** A colleague saved since this form opened: their version, for the comparison. */
const conflict = ref<"none" | "loading" | "loaded" | "missing">("none");
const theirs = ref<SingletonDetail | null>(null);

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
const location = ref("");

const form = useFormIssues(() => definition.value?.fields, values);
const issues = form.issues;

const { dirty, markClean } = useUnsavedChanges(values);
// Kept in this tab, so that signing in again after the session ended loses nothing.
const kept = useKeptChanges(() => `singleton:${props.name}`, values, revision, dirty);

/** These settings' saved changes that are not on the website yet. */
const pending = computed(() => staging.edits.value.find((edit) => edit.key === `singleton:${props.name}`) ?? null);

const state = computed(() =>
  dirty.value
    ? { label: "Unsaved changes", tone: "status-unsaved" }
    : pending.value
      ? { label: "Saved · not published", tone: "status-draft" }
      : staging.knowsPublished.value
        ? { label: "Published", tone: "status-published" }
        : { label: "Saved", tone: "" },
);

/** Why the settings could not be loaded. The form then stays hidden: an empty form would save over them. */
const loadError = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    const detail = await api.singletons.get(props.name);
    // Defaults fill in fields added to the model since the file was written.
    values.value = structuredClone(fillDefaults(definition.value?.fields ?? {}, detail.data));
    revision.value = detail.revision;
    location.value = detail.path;
    form.reset();
    conflict.value = "none";
    theirs.value = null;
    markClean();
  } catch (error) {
    loadError.value = error instanceof ApiError ? error.message : "Could not load these settings.";
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await load();
  kept.check();
  // From a problem on the Publish page: go to its field.
  if (typeof route.query.field === "string") {
    const field = route.query.field;
    await nextTick();
    focusField(field);
  }
});
watch(() => props.name, load);

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

  try {
    const keepMine = options.keepMine === true && theirs.value !== null;
    const saved = await api.singletons.save(
      props.name,
      values.value,
      keepMine ? theirs.value!.revision : revision.value,
      keepMine,
    );
    revision.value = saved.revision;
    conflict.value = "none";
    theirs.value = null;
    markClean();
    kept.forget();
    toast.success("Settings saved.");
    void staging.refresh();
    // Read back what the server wrote, such as the keys it gave to new rows (#220): the next save keeps them.
    // Not over changes that the editor made while the request ran.
    const detail = await api.singletons.get(props.name);
    if (!dirty.value) {
      values.value = structuredClone(fillDefaults(definition.value?.fields ?? {}, detail.data));
      revision.value = detail.revision;
      markClean();
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      conflict.value = "loading";
      try {
        theirs.value = await api.singletons.get(props.name);
        conflict.value = "loaded";
      } catch {
        conflict.value = "missing";
      }
    } else if (error instanceof ApiError && error.issues.length > 0) {
      form.set(error.issues);
      toast.error(error.message, `${error.issues.length} field(s) need attention.`);
      await showIssues();
    } else {
      toast.error(error instanceof ApiError ? error.message : "Could not save these settings.");
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <template v-if="definition">
    <PageHeader :title="definition.label" :subtitle="location" :loading="loading">
      <template v-if="!definition.readOnly && !loadError">
        <span :class="['status', state.tone]">
          {{ state.label }}
        </span>
        <button type="button" class="btn-primary" :disabled="saving || !dirty" @click="save()">
          {{ saving ? "Saving…" : "Save changes" }}
        </button>
      </template>
    </PageHeader>

    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <p v-if="loading" role="status" class="text-sm text-muted">Loading…</p>

      <div v-else-if="loadError" role="alert" class="rounded-md border border-danger/15 bg-danger-soft p-4">
        <p class="text-sm font-medium text-danger">These settings could not be loaded</p>
        <p class="mt-1 text-xs text-muted">{{ loadError }}</p>
        <button type="button" class="btn-secondary mt-2.5" @click="load">Try again</button>
      </div>

      <template v-else>
        <p v-if="definition.description" class="mb-5 text-sm text-muted">
          {{ definition.description }}
        </p>

        <ReadOnlyNotice v-if="definition.readOnly" :reason="definition.readOnly" />
        <PendingNotice v-else-if="pending && !dirty" :edit="pending" @discarded="kept.forget(); load()" />

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
          @keep="save({ keepMine: true })"
          @take="kept.forget(); load()"
        />

        <KeptChangesNotice v-if="kept.offered.value" :at="kept.offered.value.at" @restore="kept.restore()" @forget="kept.forget()" />
        <IssueSummary :issues="issues" />

        <form novalidate @submit.prevent="save()" @focusout="onLeave">
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
