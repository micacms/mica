<script setup lang="ts">
/**
 * Revision history (§8).
 *
 * For an SME the valuable operation is "put it back the way it was", so this
 * lists what changed, when and by whom, and offers a single restore action.
 * Restoring itself creates a revision, so it is reversible too.
 */

import { ref, watch } from "vue";

import { api, ApiError, type EntryDetail, type GlobalDetail, type RevisionSummary } from "@/api";
import ConfirmDialog from "./ConfirmDialog.vue";
import { absoluteTime, relativeTime } from "@/lib/format";
import { useToast } from "@/stores/toast";

const props = defineProps<{
  open: boolean;
  target: "entry" | "global";
  /** Entry id, or singleton name when `target` is "global". */
  entryId: string;
}>();

const emit = defineEmits<{ close: []; restored: [EntryDetail & GlobalDetail] }>();

const toast = useToast();

const revisions = ref<RevisionSummary[]>([]);
const loading = ref(false);
const pending = ref<RevisionSummary | null>(null);
const restoring = ref(false);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    loading.value = true;
    try {
      const result =
        props.target === "entry"
          ? await api.entries.revisions(props.entryId)
          : await api.globals.revisions(props.entryId);
      revisions.value = result.revisions;
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not load the history.");
    } finally {
      loading.value = false;
    }
  },
);

async function restore(): Promise<void> {
  if (!pending.value) return;
  restoring.value = true;

  try {
    const restored =
      props.target === "entry"
        ? await api.entries.restore(props.entryId, pending.value.id)
        : await api.globals.restore(props.entryId, pending.value.id);

    emit("restored", restored as EntryDetail & GlobalDetail);
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not restore that version.");
  } finally {
    restoring.value = false;
    pending.value = null;
  }
}

const authorOf = (revision: RevisionSummary): string =>
  revision.authorName || revision.authorEmail || "Unknown editor";
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-40 flex justify-end bg-black/30"
      @click.self="emit('close')"
      @keydown.esc="emit('close')"
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
        class="flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
      >
        <header class="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <h2 id="history-title" class="text-base font-semibold">History</h2>
          <button type="button" class="btn-ghost -mr-2 ml-auto px-2" @click="emit('close')">
            <svg viewBox="0 0 20 20" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.75">
              <path d="M5 5l10 10M15 5L5 15" stroke-linecap="round" />
            </svg>
            <span class="sr-only">Close history</span>
          </button>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto">
          <p v-if="loading" class="px-5 py-8 text-center text-sm text-muted">Loading…</p>

          <div v-else-if="revisions.length === 0" class="px-5 py-8 text-center">
            <p class="text-sm text-muted">
              No earlier versions yet. One is saved every time you make a change.
            </p>
          </div>

          <ol v-else class="divide-y divide-line">
            <li v-for="revision in revisions" :key="revision.id" class="px-5 py-3.5">
              <div class="flex items-start gap-3">
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">{{ revision.title }}</p>
                  <p class="mt-0.5 text-xs text-muted">
                    {{ revision.note || "Edited" }} by {{ authorOf(revision) }}
                  </p>
                  <p class="text-xs text-muted">
                    <time :datetime="revision.createdAt" :title="absoluteTime(revision.createdAt)">
                      {{ relativeTime(revision.createdAt) }}
                    </time>
                    · version {{ revision.version }}
                  </p>
                </div>

                <button type="button" class="btn-secondary shrink-0" @click="pending = revision">
                  Restore
                </button>
              </div>
            </li>
          </ol>
        </div>

        <footer class="border-t border-line px-5 py-3 text-xs text-muted">
          The 30 most recent versions are kept.
        </footer>
      </aside>
    </div>
  </Teleport>

  <ConfirmDialog
    :open="pending !== null"
    title="Restore this version?"
    confirm-label="Restore"
    :busy="restoring"
    @cancel="pending = null"
    @confirm="restore"
  >
    <p>
      The current content will be replaced with the version from
      {{ pending ? absoluteTime(pending.createdAt) : "" }}. Your current version is saved to the
      history first, so this can be undone.
    </p>
  </ConfirmDialog>
</template>
