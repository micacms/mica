<script setup lang="ts">
/**
 * Mica's own clone: the drafts that were changed on the website too. The
 * editor chooses a version for each; until then nothing can be published.
 * "Use the website's version" on a new entry deletes it, so it asks first.
 */

import { ref, watch } from "vue";

import { api, messageOf, type SyncConflict } from "@/api";
import ChangeComparison from "@/components/ChangeComparison.vue";
import { useComparisons } from "@/composables/useComparisons";
import { useStaging } from "@/stores/staging";
import { useToast } from "@/stores/toast";

const props = defineProps<{
  conflicts: SyncConflict[];
  /** Loads the page again after a choice, while its buttons still wait. */
  refresh: () => Promise<void>;
}>();

const staging = useStaging();
const toast = useToast();
const comparisons = useComparisons("origin");
const items = comparisons.items;

const resolving = ref<string | null>(null);
const confirmWebsite = ref<SyncConflict | null>(null);

watch(
  () => props.conflicts,
  (conflicts) => comparisons.loadMissing(conflicts.map((conflict) => ({ key: conflict.group, target: conflict.target }))),
  { immediate: true },
);

/** Whether taking the website's version would delete an entry the editor created. */
function discardsNewWork(conflict: SyncConflict): boolean {
  const created = new Set(
    (staging.status.value?.changes ?? []).filter((change) => change.kind === "create").map((change) => change.path),
  );
  return conflict.paths.some((path) => created.has(path));
}

async function resolve(conflict: SyncConflict, choice: "mine" | "website"): Promise<void> {
  if (choice === "website" && discardsNewWork(conflict) && confirmWebsite.value !== conflict) {
    confirmWebsite.value = conflict;
    return;
  }
  confirmWebsite.value = null;
  resolving.value = conflict.group;
  try {
    await api.staging.resolve(conflict.group, choice);
    toast.success(choice === "mine" ? `Kept your version of ${conflict.label}.` : `Took the website's version of ${conflict.label}.`);
    await props.refresh();
  } catch (error) {
    toast.error(messageOf(error, "Could not resolve the conflict."));
  } finally {
    resolving.value = null;
  }
}

const upstreamWords: Record<SyncConflict["upstream"], string> = {
  changed: "was changed on the website while you edited it",
  deleted: "was deleted on the website while you edited it",
  added: "was also created on the website",
};
</script>

<template>
  <section v-if="conflicts.length > 0" aria-labelledby="conflicts-heading" class="space-y-3">
    <h2 id="conflicts-heading" class="text-sm font-semibold">
      Changed on the website while you edited
    </h2>
    <p class="text-xs text-muted">
      Choose a version for each. Until you do, nothing can be published and the website's newer
      changes stay out of Mica.
    </p>
    <ul class="card divide-y divide-line">
      <li v-for="conflict in conflicts" :key="conflict.group" class="p-4">
        <p class="text-sm font-medium">{{ conflict.label }}</p>
        <p class="mt-0.5 text-xs text-muted">It {{ upstreamWords[conflict.upstream] }}.</p>

        <template v-if="conflict.target">
          <p v-if="items[conflict.group]?.loading" class="mt-2 text-xs text-muted">Comparing…</p>
          <p v-else-if="items[conflict.group]?.error" class="mt-2 text-xs text-danger">
            {{ items[conflict.group]?.error }}
          </p>
          <template v-else-if="items[conflict.group]?.comparison">
            <p class="mt-2 text-xs text-muted">The website's version, then yours:</p>
            <ChangeComparison
              :comparison="items[conflict.group]!.comparison!"
              :fields="comparisons.fieldsFor(conflict.target)"
            />
          </template>
        </template>

        <p v-if="confirmWebsite === conflict" role="alert" class="mt-2 text-xs text-danger">
          This deletes the entry you created. Press the button again to confirm.
        </p>
        <div class="mt-2.5 flex flex-wrap gap-2">
          <button
            type="button"
            class="btn-secondary"
            :disabled="resolving !== null"
            @click="resolve(conflict, 'mine')"
          >
            {{ conflict.upstream === "deleted" ? "Restore it" : "Keep my version" }}
          </button>
          <button
            type="button"
            class="btn-ghost"
            :disabled="resolving !== null"
            @click="resolve(conflict, 'website')"
          >
            {{ conflict.upstream === "deleted" ? "Accept the deletion" : "Use the website's version" }}
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>
