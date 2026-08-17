<script setup lang="ts">
/**
 * Singleton editor — site configuration, navigation, theme.
 *
 * A singleton is one file in the repository, so this view is the entry editor
 * without the parts that need a slug: no rename, no delete, no list to go back
 * to. What it shares is `revision` — the version the form was opened against,
 * sent back with the save so a second editor cannot be overwritten in silence.
 */

import { computed, onMounted, ref, watch } from "vue";

import { withDefaults as fillDefaults, type FieldIssue } from "@micacms/model";

import { api, ApiError } from "@/api";
import FieldList from "@/components/fields/FieldList.vue";
import PageHeader from "@/components/PageHeader.vue";
import { useUnsavedChanges } from "@/composables/useUnsavedChanges";
import { useSchema } from "@/stores/schema";
import { useToast } from "@/stores/toast";

const props = defineProps<{ name: string }>();

const schema = useSchema();
const toast = useToast();

const definition = computed(() => schema.singleton(props.name));

const values = ref<Record<string, unknown>>({});
const issues = ref<FieldIssue[]>([]);
const revision = ref<string | null>(null);
const loading = ref(true);
const saving = ref(false);
const conflict = ref(false);

/** Where these settings live, as the server reports it. */
const location = ref("");

const { dirty, markClean } = useUnsavedChanges(values);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const detail = await api.singletons.get(props.name);
    // Defaults fill in fields added to the model since the file was written.
    values.value = structuredClone(fillDefaults(definition.value?.fields ?? {}, detail.data));
    revision.value = detail.revision;
    location.value = detail.path;
    issues.value = [];
    conflict.value = false;
    markClean();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not load these settings.");
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => props.name, load);

async function save(): Promise<void> {
  saving.value = true;
  issues.value = [];

  try {
    const saved = await api.singletons.save(props.name, values.value, revision.value);
    revision.value = saved.revision;
    conflict.value = false;
    markClean();
    toast.success("Settings saved.");
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      conflict.value = true;
      toast.error("Someone else saved these settings while you were editing them.");
    } else if (error instanceof ApiError && error.issues.length > 0) {
      issues.value = error.issues;
      toast.error(error.message, `${error.issues.length} field(s) need attention.`);
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
    <PageHeader :title="definition.label" :subtitle="location">
      <span :class="['badge', dirty ? 'border-brand bg-brand-soft text-brand' : 'text-success']">
        <span class="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
        {{ dirty ? "Unsaved" : "Saved" }}
      </span>
      <button type="button" class="btn-primary" :disabled="saving || !dirty" @click="save">
        {{ saving ? "Saving…" : dirty ? "Save changes" : "Saved" }}
      </button>
    </PageHeader>

    <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <p v-if="loading" class="text-sm text-muted">Loading…</p>

      <template v-else>
        <p v-if="definition.description" class="mb-5 text-sm text-muted">
          {{ definition.description }}
        </p>

        <div
          v-if="conflict"
          role="alert"
          class="mb-5 rounded-sm border border-warning/30 border-l-2 bg-warning/5 p-3.5"
        >
          <p class="text-sm font-medium text-warning">These settings changed while you were editing</p>
          <p class="mt-1 text-xs text-muted">
            Nothing has been saved. Copy anything you need, then load the current version.
          </p>
          <button type="button" class="btn-secondary mt-2.5" @click="load">
            Discard mine and reload
          </button>
        </div>

        <div
          v-if="issues.length"
          role="alert"
          class="mb-5 rounded-sm border border-danger/25 border-l-2 bg-danger/5 p-3.5"
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
          />
          <button type="submit" class="sr-only">Save</button>
        </form>
      </template>
    </div>
  </template>

  <div v-else class="p-8 text-center text-sm text-muted">
    There are no settings called "{{ name }}".
  </div>
</template>
