<script setup lang="ts">
/**
 * The status of an entry or settings, below the page's title: one pill for two questions.
 * Its colour and word say whether the work is saved. Its dot says whether there is
 * something to publish: none for nothing, glint for a new or changed one, with a warning
 * mark when it cannot be published yet. The popover has the details and "Discard changes".
 * The pill does not wrap, so that the header stays still while the editor types.
 */

import { computed, ref } from "vue";
import { TriangleAlert } from "@lucide/vue";

import { api, messageOf } from "@/api";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import StatusPopover from "@/components/StatusPopover.vue";
import type { SaveState } from "@/composables/useDocumentEditor";
import { problemsByEdit, reviewedPaths, type Edit } from "@/lib/edits";
import { relativeTime } from "@/lib/format";
import { useStaging } from "@/stores/staging";
import { useToast } from "@/stores/toast";

const props = defineProps<{
  state: SaveState;
  /** Its saved changes that are not published yet. */
  edit: Edit | null;
  /** Changed on the website while it has saved changes here: Mica's own clone only. */
  websiteConflict?: boolean;
}>();
const emit = defineEmits<{ discarded: [edit: Edit]; retry: []; fix: [] }>();

const staging = useStaging();
const toast = useToast();

/** What stops it from being published, such as a required value that is still empty. */
const missing = computed(() => {
  const edit = props.edit;
  if (!edit) return [];
  return (problemsByEdit([edit], staging.status.value?.validation.problems ?? []).get(edit.key) ?? []).flatMap((problem) =>
    problem.issues.map((issue) => issue.message),
  );
});
const blocked = computed(() => missing.value.length > 0 || !!props.websiteConflict);

/** The second question, in words: the dot only repeats it (brand guide, Status). */
const change = computed(() => {
  if (!props.edit) return props.state.kind === "new" ? null : "Nothing to publish.";
  return props.edit.state === "new" ? "New. It is not published yet." : "Changed since the last publication.";
});

const saveLine = computed(() => {
  const state = props.state;
  if (state.kind === "new") return "Create it to save it.";
  if (state.kind === "saving") return "Saving your changes…";
  if (state.kind === "invalid") return "Some fields break a rule, so Mica cannot save them.";
  if (state.kind === "failed") return state.message ?? "The last save failed.";
  if (state.kind === "conflict") return "Somebody else saved this while you were editing.";
  const saved = props.edit?.savedAt ? `Saved ${relativeTime(props.edit.savedAt)}.` : "Everything is saved.";
  return state.kind === "waiting" ? `${saved} The new ID is saved when you choose Change ID.` : saved;
});

/** The pill's name for a screen reader: both questions. */
const name = computed(() =>
  [props.state.label, props.edit ? (props.edit.state === "new" ? "new, not published yet" : "changed since the last publication") : null, blocked.value ? "cannot be published yet" : null]
    .filter(Boolean)
    .join(", "),
);

/** A save that did not happen is said at once; "Saving…" and "Saved" are not, as they change at each pause. */
const alertText = computed(() => (props.state.kind === "failed" || props.state.kind === "conflict" ? props.state.label : ""));

function act(close: () => void, event: "retry" | "fix"): void {
  close();
  if (event === "retry") emit("retry");
  else emit("fix");
}

/* Discard */
const confirming = ref(false);
const discarding = ref(false);

function askDiscard(close: () => void): void {
  close();
  confirming.value = true;
}

async function discard(): Promise<void> {
  const edit = props.edit;
  if (!edit) return;
  discarding.value = true;
  try {
    // At the revisions of the change list: a colleague's later save is refused, not discarded.
    await api.staging.discard(reviewedPaths([edit]));
    toast.success("Discarded the changes.");
    confirming.value = false;
    // Before the refresh: it removes the edit, and with it this status, which then cannot emit.
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
  <StatusPopover :name="name" :tone="`before:hidden ${state.tone}`">
    <template #pill>
      <span
        v-if="edit || state.kind === 'saving'"
        :class="[
          'h-2 w-2 shrink-0 rounded-full',
          edit ? 'bg-glint ring-1 ring-on-glint ring-inset' : 'bg-muted',
          state.kind === 'saving' && 'motion-safe:animate-pulse',
        ]"
        aria-hidden="true"
      />
      <span aria-hidden="true">{{ state.label }}</span>
      <TriangleAlert v-if="blocked" :size="12" aria-hidden="true" />
    </template>

    <template #default="{ close }">
      <div>
        <p :class="state.kind === 'failed' ? 'text-danger' : ''">{{ saveLine }}</p>
        <button v-if="state.kind === 'failed'" type="button" class="btn-secondary mt-2 px-2.5 py-1 text-xs" @click="act(close, 'retry')">Try again</button>
        <button v-else-if="state.kind === 'invalid'" type="button" class="btn-secondary mt-2 px-2.5 py-1 text-xs" @click="act(close, 'fix')">
          Show the fields
        </button>
        <button v-else-if="state.kind === 'conflict'" type="button" class="btn-secondary mt-2 px-2.5 py-1 text-xs" @click="act(close, 'fix')">
          Choose a version
        </button>
      </div>

      <p v-if="change">{{ change }}</p>

      <div v-if="blocked" class="font-medium text-warning">
        <p v-if="missing.length > 0">Cannot be published yet: {{ missing.join(" ") }}</p>
        <p v-if="websiteConflict">
          Changed on the website while you edited.
          <RouterLink :to="{ name: 'changes' }" class="underline underline-offset-2 hover:no-underline" @click="close()">Choose a version</RouterLink>
        </p>
      </div>

      <div v-if="edit" class="border-t border-line pt-2">
        <button type="button" class="font-medium text-muted underline-offset-2 hover:text-ink hover:underline" @click="askDiscard(close)">
          Discard changes
        </button>
      </div>
    </template>
  </StatusPopover>
  <span class="sr-only" role="alert">{{ alertText }}</span>

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
