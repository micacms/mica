<script setup lang="ts">
/**
 * "Saved, not on the website yet" on an entry or singleton page, with the way
 * to publish it and the way back.
 */

import { computed, ref } from "vue";

import { api, ApiError } from "@/api";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { problemsByEdit, type Edit } from "@/lib/edits";
import { relativeTime } from "@/lib/format";
import { useStaging } from "@/stores/staging";
import { useToast } from "@/stores/toast";

const props = defineProps<{ edit: Edit }>();
const emit = defineEmits<{ discarded: [edit: Edit] }>();

const staging = useStaging();
const toast = useToast();
const confirming = ref(false);

/** What stops it from being published, such as a required value that is still empty. */
const missing = computed(() =>
  (problemsByEdit([props.edit], staging.status.value?.validation.problems ?? []).get(props.edit.key) ?? []).flatMap(
    (problem) => problem.issues.map((issue) => issue.message),
  ),
);
const discarding = ref(false);

const words: Record<Edit["state"], string> = {
  new: "New, and not on the website yet.",
  changed: "Saved, and not on the website yet.",
  removed: "Removed, and still on the website until you publish.",
};

async function discard(): Promise<void> {
  discarding.value = true;
  try {
    await api.staging.discard(props.edit.fileChanges.map((change) => change.path));
    toast.success("Discarded the changes.");
    confirming.value = false;
    // Before the refresh: it removes the edit, and with it this notice, which then cannot emit.
    emit("discarded", props.edit);
    await staging.refresh();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not discard.");
  } finally {
    discarding.value = false;
  }
}
</script>

<template>
  <div role="status" class="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line bg-subtle px-4 py-3">
    <p class="min-w-0 flex-1 text-sm">
      {{ words[edit.state] }}
      <span v-if="edit.savedAt" class="text-xs text-muted">Saved {{ relativeTime(edit.savedAt) }}.</span>
      <span v-if="missing.length > 0" class="block text-xs font-medium text-warning">
        Not ready to publish: {{ missing.join(" ") }}
      </span>
    </p>
    <RouterLink :to="{ name: 'changes' }" class="btn-secondary">Publish…</RouterLink>
    <button type="button" class="btn-ghost" @click="confirming = true">Discard changes</button>
  </div>

  <ConfirmDialog
    :open="confirming"
    title="Discard the changes?"
    confirm-label="Discard"
    destructive
    :busy="discarding"
    @cancel="confirming = false"
    @confirm="discard"
  >
    <p v-if="edit.state === 'new'">This deletes it. It was never published. It cannot be undone.</p>
    <p v-else>This puts it back as it was at the last publication. It cannot be undone.</p>
  </ConfirmDialog>
</template>
