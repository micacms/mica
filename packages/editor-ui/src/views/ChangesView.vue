<script setup lang="ts">
/**
 * The pending change set, and Publish.
 *
 * This view is where Saved and Published stop being abstract words: everything
 * listed here is durable in the draft workspace and absent from the
 * repository's history until the button at the bottom is pressed. The list is
 * shared by the whole site — one pending set, not one per editor — so
 * everything on it is published together, whoever presses the button.
 *
 * Both owners of the working tree speak through one API: the developer's
 * checkout is worded in Git's terms and pushed with their own Git; the clone
 * that a self-hosted Mica keeps is worded for editors, and Mica keeps it in
 * step with the website — which is where conflicts come from. The `owner`
 * field decides the phrasing; the behaviour is the same.
 */

import { computed, onMounted, ref, watch } from "vue";
import { RefreshCw } from "@lucide/vue";

import type { FieldMap } from "@micacms/core";

import {
  api,
  ApiError,
  type Comparison,
  type CompareTarget,
  type FileChange,
  type PublishOutcome,
  type SyncConflict,
} from "@/api";
import ChangeComparison from "@/components/ChangeComparison.vue";
import type { Edit } from "@/lib/edits";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import PageHeader from "@/components/PageHeader.vue";
import { useSchema } from "@/stores/schema";
import { useStaging } from "@/stores/staging";
import { useToast } from "@/stores/toast";

const schema = useSchema();
const staging = useStaging();
const toast = useToast();

const loading = ref(true);
const publishing = ref(false);
const pushing = ref(false);
const message = ref("");
const discardTarget = ref<Edit | null>(null);
const discarding = ref(false);

/** The half-finished publication, when a local push failed. */
const pendingPush = ref<PublishOutcome | null>(null);

const status = staging.status;

/** One row per edit, never per file — see `lib/edits.ts`. */
const edits = staging.edits;

/* ------------------------------------------------- before/after */

interface LoadedComparison {
  loading: boolean;
  error: string | null;
  comparison: Comparison | null;
}

const comparisons = ref<Record<string, LoadedComparison>>({});

/** The compared document's fields — null for an order comparison. */
function fieldsFor(target: CompareTarget): FieldMap | null {
  if (target.kind === "entry") return schema.collection(target.collection)?.fields ?? null;
  if (target.kind === "singleton") return schema.singleton(target.name)?.fields ?? null;
  return null;
}

async function loadComparison(edit: Edit): Promise<void> {
  if (!edit.target) return;
  comparisons.value[edit.key] = { loading: true, error: null, comparison: null };
  try {
    const comparison = await api.staging.compare(edit.target);
    comparisons.value[edit.key] = { loading: false, error: null, comparison };
  } catch (error) {
    comparisons.value[edit.key] = {
      loading: false,
      error: error instanceof ApiError ? error.message : "Could not load the comparison.",
      comparison: null,
    };
  }
}

// The comparison is the change list, so it loads with it — every edit, as
// soon as it appears, without anything to click.
watch(edits, (next) => {
  for (const edit of next) {
    if (edit.target && !comparisons.value[edit.key]) void loadComparison(edit);
  }
});

/** The developer's checkout, worded in Git's terms; otherwise Mica's own clone, worded for editors. */
const isTree = computed(() => status.value?.owner === "developer");
const sync = computed(() => status.value?.sync ?? null);

const subtitle = computed(() => {
  if (!status.value) return null;
  if (isTree.value) {
    return status.value.branch
      ? `Your working tree, on branch ${status.value.branch}`
      : "Your working tree";
  }
  return "Saved in Mica, waiting to be published";
});

/** Commits already made and not yet pushed — visible even across a restart. The developer retries; Mica retries its own. */
const waitingToPush = computed(
  () => isTree.value && (pendingPush.value !== null || (status.value?.ahead ?? 0) > 0),
);

const canPublish = computed(
  () =>
    (status.value?.publish.enabled ?? false) &&
    (status.value?.validation.ok ?? false) &&
    (status.value?.changes.length ?? 0) > 0 &&
    !publishing.value,
);

const kindWord: Record<FileChange["kind"], string> = {
  create: "Added",
  update: "Changed",
  delete: "Removed",
};

async function refresh(): Promise<void> {
  // Forget the comparisons first, so the edits watcher reloads every one of
  // them against the refreshed change set instead of showing a stale panel.
  comparisons.value = {};
  await staging.refresh();
  for (const edit of edits.value) {
    if (edit.target && !comparisons.value[edit.key]) void loadComparison(edit);
  }
  loading.value = false;
}

onMounted(refresh);

async function publish(): Promise<void> {
  publishing.value = true;
  try {
    // Exactly what the editor sees here, at the revision they see it: a file
    // saved again since makes the server refuse rather than publish it unseen.
    const reviewed = Object.fromEntries(
      (status.value?.changes ?? []).map((change) => [change.path, change.revision ?? null]),
    );
    const outcome = await api.staging.publish(message.value, reviewed);

    if (outcome.state === "published") {
      pendingPush.value = null;
      message.value = "";
      toast.success("Published.", outcome.revision ? `Commit ${short(outcome.revision)}.` : undefined);
    } else if (isTree.value) {
      // The commit is real; only the push failed. Say so, and keep the retry
      // visible — pressing Publish again must not create a second commit.
      pendingPush.value = outcome;
      message.value = "";
      toast.error("Committed, but the push failed.", outcome.pushError);
    } else {
      message.value = "";
      toast.error("Published in Mica, not yet sent to the website.", "Mica tries again every minute.");
    }

    await staging.refresh();
  } catch (error) {
    if (error instanceof ApiError) {
      toast.error(error.message, error.issues[0]?.message);
      // A conflict or a validation refusal means the list moved: show the truth.
      await staging.refresh();
    } else {
      toast.error("Could not publish.");
    }
  } finally {
    publishing.value = false;
  }
}

async function retryPush(): Promise<void> {
  pushing.value = true;
  try {
    const outcome = await api.staging.push();
    if (outcome.state === "published") {
      pendingPush.value = null;
      toast.success("Pushed.", outcome.revision ? `Commit ${short(outcome.revision)}.` : undefined);
    } else {
      pendingPush.value = outcome;
      toast.error("The push failed again.", outcome.pushError);
    }
    await staging.refresh();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not push.");
  } finally {
    pushing.value = false;
  }
}

async function discard(): Promise<void> {
  const edit = discardTarget.value;
  if (!edit) return;

  discarding.value = true;
  try {
    await api.staging.discard(edit.fileChanges.map((change) => change.path));
    toast.success(`Discarded the changes to ${edit.label}.`);
    discardTarget.value = null;
    await staging.refresh();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not discard.");
  } finally {
    discarding.value = false;
  }
}

/* --------------------------------------------- Mica's own clone */

const syncing = ref(false);
const resolving = ref<string | null>(null);
/** "Use the website's version" on a new entry deletes it, so it asks first. */
const confirmWebsite = ref<SyncConflict | null>(null);

async function syncNow(): Promise<void> {
  syncing.value = true;
  try {
    await api.staging.sync();
    await refresh();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not reach the repository.");
  } finally {
    syncing.value = false;
  }
}

/** Whether taking the website's version would delete an entry the editor created. */
function discardsNewWork(conflict: SyncConflict): boolean {
  const created = new Set(
    (status.value?.changes ?? []).filter((change) => change.kind === "create").map((change) => change.path),
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
    await refresh();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not resolve the conflict.");
  } finally {
    resolving.value = null;
  }
}

const upstreamWords: Record<SyncConflict["upstream"], string> = {
  changed: "was changed on the website while you edited it",
  deleted: "was deleted on the website while you edited it",
  added: "was also created on the website",
};

const conflictComparisons = ref<Record<string, LoadedComparison>>({});

async function loadConflictComparison(conflict: SyncConflict): Promise<void> {
  if (!conflict.target) return;
  conflictComparisons.value[conflict.group] = { loading: true, error: null, comparison: null };
  try {
    const comparison = await api.staging.compare(conflict.target, "origin");
    conflictComparisons.value[conflict.group] = { loading: false, error: null, comparison };
  } catch (error) {
    conflictComparisons.value[conflict.group] = {
      loading: false,
      error: error instanceof ApiError ? error.message : "Could not load the comparison.",
      comparison: null,
    };
  }
}

watch(
  () => sync.value?.conflicts ?? [],
  (conflicts) => {
    for (const conflict of conflicts) {
      if (!conflictComparisons.value[conflict.group]) void loadConflictComparison(conflict);
    }
  },
);

function since(iso: string): string {
  return new Date(iso).toLocaleString();
}

function short(revision: string): string {
  return /^[0-9a-f]{20,}$/i.test(revision) ? revision.slice(0, 7) : revision;
}
</script>

<template>
  <PageHeader title="Publish" :subtitle="subtitle">
    <button type="button" class="btn-ghost px-2" :disabled="loading" @click="refresh">
      <RefreshCw :size="16" aria-hidden="true" />
      <span class="sr-only">Refresh the change list</span>
    </button>
  </PageHeader>

  <div class="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
    <p v-if="loading" class="text-sm text-muted">Loading…</p>

    <template v-else-if="status">
      <!-- Publishing unavailable: still an honest, read-only change list. -->
      <div
        v-if="!status.publish.enabled"
        class="rounded-md border border-line bg-subtle p-4 text-sm text-muted"
      >
        <p class="font-medium text-ink">Publishing is not available here</p>
        <p class="mt-1">{{ status.publish.reason }}</p>
      </div>

      <!-- Mica's own clone: shown only when something needs attention. -->
      <template v-if="sync">
        <div v-if="sync.restartRequired" role="alert" class="rounded-md border border-warning/15 bg-warning-soft p-4">
          <p class="text-sm font-medium text-warning">The content model changed on the website</p>
          <p class="mt-1 text-xs text-muted">
            You can go on saving. To publish, ask the person who runs Mica to restart it.
          </p>
        </div>

        <div v-if="sync.error" role="alert" class="rounded-md border border-warning/15 bg-warning-soft p-4">
          <p class="text-sm font-medium text-warning">Cannot reach the repository since {{ since(sync.error.since) }}</p>
          <p class="mt-1 text-xs text-muted">
            You can go on saving. Mica tries again every minute. If this stays, tell the person who runs Mica:
            {{ sync.error.message }}
          </p>
          <button type="button" class="btn-secondary mt-2.5" :disabled="syncing" @click="syncNow">
            {{ syncing ? "Trying…" : "Try again" }}
          </button>
        </div>

        <div v-if="sync.pendingPush" role="status" class="rounded-md border border-line bg-subtle p-4">
          <p class="text-sm font-medium">Published in Mica, not yet sent to the website</p>
          <p class="mt-1 text-xs text-muted">
            Mica tries again every minute. If this stays, tell the person who runs Mica:
            {{ sync.pendingPush.reason }}
          </p>
        </div>

        <div v-if="sync.refused" role="alert" class="rounded-md border border-danger/15 bg-danger-soft p-4">
          <p class="text-sm font-medium text-danger">The repository refused the last publication</p>
          <p class="mt-1 text-xs text-muted">
            Its changes are drafts again, listed below. Tell the person who runs Mica: {{ sync.refused.reason }}
          </p>
        </div>

        <section v-if="sync.conflicts.length > 0" aria-labelledby="conflicts-heading" class="space-y-3">
          <h2 id="conflicts-heading" class="text-sm font-semibold">
            Changed on the website while you edited
          </h2>
          <p class="text-xs text-muted">
            Choose a version for each. Until you do, nothing can be published and the website's newer
            changes stay out of Mica.
          </p>
          <ul class="card divide-y divide-line">
            <li v-for="conflict in sync.conflicts" :key="conflict.group" class="p-4">
              <p class="text-sm font-medium">{{ conflict.label }}</p>
              <p class="mt-0.5 text-xs text-muted">It {{ upstreamWords[conflict.upstream] }}.</p>

              <template v-if="conflict.target">
                <p v-if="conflictComparisons[conflict.group]?.loading" class="mt-2 text-xs text-muted">Comparing…</p>
                <p v-else-if="conflictComparisons[conflict.group]?.error" class="mt-2 text-xs text-danger">
                  {{ conflictComparisons[conflict.group]?.error }}
                </p>
                <template v-else-if="conflictComparisons[conflict.group]?.comparison">
                  <p class="mt-2 text-xs text-muted">The website's version, then yours:</p>
                  <ChangeComparison
                    :comparison="conflictComparisons[conflict.group]!.comparison!"
                    :fields="fieldsFor(conflict.target)"
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

      <!-- A commit exists that the repository's remote has not seen. -->
      <div
        v-if="waitingToPush"
        role="alert"
        class="rounded-md border border-warning/15 bg-warning-soft p-4"
      >
        <p class="text-sm font-medium text-warning">Committed, waiting to be pushed</p>
        <p class="mt-1 text-xs text-muted">
          {{
            pendingPush?.pushError ??
            "This branch has commits the remote has not seen. Retrying pushes the existing " +
              "commits — it never creates new ones."
          }}
        </p>
        <button
          type="button"
          class="btn-secondary mt-2.5"
          :disabled="pushing"
          @click="retryPush"
        >
          {{ pushing ? "Pushing…" : "Retry push" }}
        </button>
      </div>

      <div
        v-if="!status.validation.ok"
        role="alert"
        class="rounded-md border border-danger/15 bg-danger-soft p-4"
      >
        <p class="text-sm font-medium text-danger">
          These changes cannot be published until they are fixed
        </p>
        <ul class="mt-1.5 space-y-1 text-xs text-danger">
          <li v-for="problem in status.validation.problems" :key="problem.path">
            <span class="font-medium">{{ problem.label }}</span>
            <template v-if="problem.issues.length">
              — {{ problem.issues.map((issue) => issue.message).join("; ") }}
            </template>
          </li>
        </ul>
      </div>

      <!-- Nothing pending -->
      <div v-if="edits.length === 0" class="card p-8 text-center">
        <p class="text-sm font-medium">Nothing waiting to be published</p>
        <p class="mt-1 text-sm text-muted">
          Saved changes collect here until somebody publishes them. Right now the
          {{ isTree ? "working tree" : "draft workspace" }} matches the repository.
        </p>
      </div>

      <!-- The pending set -->
      <section v-else aria-labelledby="changes-heading">
        <h2 id="changes-heading" class="sr-only">Pending changes</h2>

        <ul class="card divide-y divide-line">
          <li v-for="edit in edits" :key="edit.key" class="flex items-start gap-3 p-4">
            <div class="min-w-0 flex-1">
              <component
                :is="edit.link ? 'RouterLink' : 'p'"
                v-bind="edit.link ? { to: edit.link } : {}"
                :class="['text-sm font-medium', edit.link && 'hover:underline']"
              >
                {{ edit.label }}
              </component>

              <!-- What the change does. Edits with a document get the
                   before/after view and no file paths; media and everything
                   else have only their files to show. -->
              <template v-if="edit.target">
                <p v-if="comparisons[edit.key]?.loading" class="mt-2 text-xs text-muted">
                  Comparing…
                </p>
                <p v-else-if="comparisons[edit.key]?.error" class="mt-2 text-xs text-danger">
                  {{ comparisons[edit.key]?.error }}
                </p>
                <ChangeComparison
                  v-else-if="comparisons[edit.key]?.comparison"
                  :comparison="comparisons[edit.key]!.comparison!"
                  :fields="fieldsFor(edit.target)"
                />
              </template>

              <ul v-else class="mt-1 space-y-0.5">
                <li
                  v-for="change in edit.fileChanges"
                  :key="change.path"
                  class="flex items-baseline gap-2 text-xs text-muted"
                >
                  <span
                    :class="[
                      'w-16 shrink-0 font-mono text-[11px]',
                      change.kind === 'delete' ? 'text-danger' : change.kind === 'create' ? 'text-success' : '',
                    ]"
                  >
                    {{ kindWord[change.kind] }}
                  </span>
                  <span class="break-all font-mono">{{ change.path }}</span>
                </li>
              </ul>
            </div>

            <button type="button" class="btn-ghost shrink-0 text-xs" @click="discardTarget = edit">
              Discard
            </button>
          </li>
        </ul>
      </section>

      <!-- Publish -->
      <section v-if="edits.length > 0 && status.publish.enabled" class="card p-4" aria-labelledby="publish-heading">
        <h2 id="publish-heading" class="text-sm font-semibold">
          Publish {{ edits.length === 1 ? "this edit" : `these ${edits.length} edits` }}
        </h2>

        <p class="mt-1 text-xs text-muted">
          {{
            isTree
              ? "One commit of exactly the files listed above, pushed with your own Git configuration."
              : "One commit to the content repository, which is what triggers your site's build."
          }}
          <template v-if="isTree && status.head"> Based on {{ short(status.head) }}.</template>
        </p>

        <form class="mt-3 flex flex-wrap items-center gap-2" @submit.prevent="canPublish && message.trim() && publish()">
          <input
            v-model="message"
            type="text"
            class="input min-w-0 flex-1"
            maxlength="500"
            placeholder="Describe this publication — it becomes the commit message"
            aria-label="Commit message"
            :disabled="publishing"
          />
          <button type="submit" class="btn-primary" :disabled="!canPublish || !message.trim()">
            {{ publishing ? "Publishing…" : "Publish" }}
          </button>
        </form>
      </section>
    </template>

    <p v-else class="text-sm text-muted">The change list could not be loaded. Reload to retry.</p>
  </div>

  <ConfirmDialog
    :open="discardTarget !== null"
    :title="`Discard the changes to “${discardTarget?.label}”?`"
    confirm-label="Discard"
    destructive
    :busy="discarding"
    @cancel="discardTarget = null"
    @confirm="discard"
  >
    <p v-if="isTree">
      This restores the files in your working tree to the last commit — new files are deleted,
      edited ones go back. It cannot be undone from here.
    </p>
    <p v-else>
      This forgets the saved changes; the repository stays exactly as it is. It cannot be undone
      from here.
    </p>
  </ConfirmDialog>
</template>
