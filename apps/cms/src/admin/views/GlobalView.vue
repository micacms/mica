<script setup lang="ts">
/**
 * Singleton editor — site configuration, navigation, theme (§17, §18).
 *
 * A singleton has no draft state: saving it is publishing it, so there is one
 * button and validation is always strict.
 */

import { computed, onMounted, ref, watch } from "vue";

import { withDefaults as fillDefaults, type FieldIssue } from "@micacms/model";

import { api, ApiError, type GlobalDetail } from "@/api";
import FieldList from "@/components/fields/FieldList.vue";
import PageHeader from "@/components/PageHeader.vue";
import RevisionPanel from "@/components/RevisionPanel.vue";
import { provideMediaRegistry } from "@/composables/mediaRegistry";
import { useUnsavedChanges } from "@/composables/useUnsavedChanges";
import { absoluteTime } from "@/lib/format";
import { useSchema } from "@/stores/schema";
import { useToast } from "@/stores/toast";

const props = defineProps<{ name: string }>();

const schema = useSchema();
const toast = useToast();
const registry = provideMediaRegistry();

const definition = computed(() => schema.global(props.name));

const values = ref<Record<string, unknown>>({});
const issues = ref<FieldIssue[]>([]);
const detail = ref<GlobalDetail | null>(null);
const loading = ref(true);
const saving = ref(false);
const showRevisions = ref(false);

const { dirty, markClean } = useUnsavedChanges(values);

function setBaseline(next: GlobalDetail): void {
  detail.value = next;
  values.value = structuredClone(
    fillDefaults(definition.value?.fields ?? {}, next.raw),
  );
  registry.add(next.media);
  issues.value = [];
  markClean();
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    setBaseline(await api.globals.get(props.name));
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
    setBaseline(await api.globals.save(props.name, values.value));
    toast.success("Settings saved.");
  } catch (error) {
    if (error instanceof ApiError && error.issues.length > 0) {
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
    <PageHeader
      :title="definition.label"
      :subtitle="
        detail?.updatedAt ? `Last saved ${absoluteTime(detail.updatedAt)}` : definition.description
      "
    >
      <button type="button" class="btn-ghost" @click="showRevisions = true">History</button>
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

    <RevisionPanel
      :open="showRevisions"
      target="global"
      :entry-id="name"
      @close="showRevisions = false"
      @restored="
        (restored) => {
          setBaseline(restored);
          showRevisions = false;
          toast.success('Settings restored.');
        }
      "
    />
  </template>

  <div v-else class="p-8 text-center text-sm text-muted">
    There are no settings called "{{ name }}".
  </div>
</template>
