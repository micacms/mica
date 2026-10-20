<script setup lang="ts">
/**
 * The status of an entry or settings in the page header: saving, saved and not
 * on the website yet, with when it was saved or what stops its publication,
 * and the way to publish it and the way back. Its size does not change while
 * the status does, so that the header stays still while the editor types.
 */

import { computed, ref } from "vue";

import { api, messageOf } from "@/api";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { problemsByEdit, reviewedPaths, type Edit } from "@/lib/edits";
import { relativeTime } from "@/lib/format";
import { useStaging } from "@/stores/staging";
import { useToast } from "@/stores/toast";

const props = defineProps<{
  /** From `useDocumentEditor`: "Saving…", "Saved · not published". */
  state: { label: string; tone: string };
  /** Its saved changes that are not on the website yet. */
  edit: Edit | null;
}>();
const emit = defineEmits<{ discarded: [edit: Edit] }>();

const staging = useStaging();
const toast = useToast();
const confirming = ref(false);

/** What stops it from being published, such as a required value that is still empty. */
const missing = computed(() => {
  const edit = props.edit;
  if (!edit) return [];
  return (problemsByEdit([edit], staging.status.value?.validation.problems ?? []).get(edit.key) ?? []).flatMap((problem) =>
    problem.issues.map((issue) => issue.message),
  );
});
const discarding = ref(false);

/** The line below the status: what stops the publication, or when it was saved. */
const detail = computed(() => {
  if (missing.value.length > 0) return `Not ready to publish: ${missing.value.join(" ")}`;
  return props.edit?.savedAt ? `Saved ${relativeTime(props.edit.savedAt)}` : "";
});

async function discard(): Promise<void> {
  const edit = props.edit;
  if (!edit) return;
  discarding.value = true;
  try {
    // At the revisions of the change list: a colleague's later save is refused, not discarded.
    await api.staging.discard(reviewedPaths([edit]));
    toast.success("Discarded the changes.");
    confirming.value = false;
    // Before the refresh: it removes the edit, and with it this notice, which then cannot emit.
    emit("discarded", edit);
    await staging.refresh();
  } catch (error) {
    toast.error(messageOf(error, "Could not discard."));
  } finally {
    discarding.value = false;
  }
}
</script>

<template>
  <div class="flex items-center gap-2">
    <!-- A fixed width and two lines, also when the second is empty: the status changes, the header does not move. -->
    <div class="flex w-44 flex-col items-end">
      <span :class="['status', state.tone]">{{ state.label }}</span>
      <span
        :class="['mt-0.5 h-4 max-w-full truncate text-xs leading-4', missing.length > 0 ? 'font-medium text-warning' : 'text-muted']"
        :title="detail || undefined"
      >
        {{ detail }}
      </span>
    </div>
    <template v-if="edit">
      <RouterLink :to="{ name: 'changes' }" class="btn-secondary">Publish…</RouterLink>
      <button type="button" class="btn-ghost" @click="confirming = true">Discard changes</button>
    </template>
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
    <p v-if="edit?.state === 'new'">This deletes it. It was never published. It cannot be undone.</p>
    <p v-else>This puts it back as it was at the last publication. It cannot be undone.</p>
  </ConfirmDialog>
</template>
