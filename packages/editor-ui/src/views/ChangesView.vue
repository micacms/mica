<script setup lang="ts">
/**
 * The saved changes that are not on the website yet, and Publish. The whole
 * site shares them; the editor chooses which of them to publish now, and the
 * rest stays saved. `owner` changes only the developer details, not the words.
 */

import { computed, onMounted, ref, watch } from "vue";
import { RefreshCw } from "@lucide/vue";

import type { FieldMap } from "@micacms/core/internal";

import {
  api,
  ApiError,
  messageOf,
  type CompareTarget,
  type Comparison,
  type FileChange,
  type PublishOutcome,
  type SyncConflict,
} from "@/api";
import ChangeComparison from "@/components/ChangeComparison.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import DeveloperDetails from "@/components/DeveloperDetails.vue";
import ModelNotice from "@/components/ModelNotice.vue";
import PageHeader from "@/components/PageHeader.vue";
import StatusNotice from "@/components/StatusNotice.vue";
import {
  blockedEdits,
  problemsByEdit,
  publishSummary,
  reviewedPaths,
  withNeeds,
  withoutDependents,
  type Edit,
} from "@/lib/edits";
import { relativeTime } from "@/lib/format";
import { pageOfOwner } from "@/lib/pages";
import { useSchema } from "@/stores/schema";
import { useStaging } from "@/stores/staging";
import { useToast } from "@/stores/toast";

const schema = useSchema();
const staging = useStaging();
const toast = useToast();

const loading = ref(true);
const publishing = ref(false);
const pushing = ref(false);
const discardTarget = ref<Edit | null>(null);
const discarding = ref(false);

/** The last publication on this page, for the success panel. */
const published = ref<{ revision: string | null; pages: Array<{ label: string; href: string }> } | null>(null);

/** The pages that the chosen changes show on, before Publish takes them off the list. */
function pagesOf(chosenEdits: Edit[]): Array<{ label: string; href: string }> {
  const pages = new Map<string, string>();
  for (const edit of chosenEdits) {
    if (edit.state === "removed") continue;
    const owner = edit.fileChanges[0]?.owner;
    const href = owner ? pageOfOwner(owner, schema.schema.value) : null;
    if (href) pages.set(href, edit.label);
  }
  return [...pages].map(([href, label]) => ({ label, href }));
}

/** A publication in the developer's checkout that did not reach the website. */
const pendingPush = ref<PublishOutcome | null>(null);

const status = staging.status;

/** One row per edit, never per file — see `lib/edits.ts`. */
const edits = staging.edits;

const problems = computed(() => problemsByEdit(edits.value, status.value?.validation.problems ?? []));
/** Edits that cannot be published now: a problem in them, or in what they need. */
const blocked = computed(() => blockedEdits(edits.value, problems.value));
const labelOf = computed(() => new Map(edits.value.map((edit) => [edit.key, edit.label])));
/** Edits that another pending edit uses: a new shared upload outside this set is not in any field yet. */
const neededKeys = computed(() => new Set(edits.value.flatMap((edit) => edit.needs)));

/** Where a problem can be fixed: its entry or settings page, at the field. */
function fixLink(problemPath: string, field: string) {
  const edit = edits.value.find((candidate) =>
    (problems.value.get(candidate.key) ?? []).some((problem) => problem.path === problemPath),
  );
  return edit?.link ? { ...edit.link, ...(field ? { query: { field } } : {}) } : null;
}

/* ------------------------------------------------- the selection */

/**
 * The edits to publish now. A new edit starts selected unless it is blocked;
 * the editor's own choices stay when the list refreshes. An edit always comes
 * with the new edits it needs, and goes with the edits that need it.
 */
const selected = ref(new Set<string>());
const offered = new Set<string>();

function updateSelection(next: Edit[]): void {
  const keys = new Set(next.map((edit) => edit.key));
  const kept = new Set([...selected.value].filter((key) => keys.has(key) && !blocked.value.has(key)));
  for (const edit of next) {
    // An edit that is blocked when it first appears is offered once it is fixed.
    if (offered.has(edit.key) || blocked.value.has(edit.key)) continue;
    offered.add(edit.key);
    kept.add(edit.key);
  }
  selected.value = withNeeds(kept, next);
}

function toggle(key: string): void {
  selected.value = selected.value.has(key)
    ? withoutDependents(selected.value, key, edits.value)
    : withNeeds([...selected.value, key], edits.value);
}

function selectAll(on: boolean): void {
  selected.value = new Set(on ? selectable.value.map((edit) => edit.key) : []);
}

const chosen = computed(() => edits.value.filter((edit) => selected.value.has(edit.key)));
const selectable = computed(() => edits.value.filter((edit) => !blocked.value.has(edit.key)));

/** The summary: Mica's suggestion until the editor types their own. */
const typed = ref<string | null>(null);
const summary = computed({
  get: () => typed.value ?? publishSummary(chosen.value),
  set: (value: string) => {
    typed.value = value;
  },
});

/* ------------------------------------------------- before/after */

interface LoadedComparison {
  loading: boolean;
  error: string | null;
  comparison: Comparison | null;
}

const comparisons = ref<Record<string, LoadedComparison>>({});

/** The revisions of the comparison on the page: Publish and Discard send these, not a newer list's. */
const shownRevisions = (edit: Edit) => comparisons.value[edit.key]?.comparison?.revisions ?? {};

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
      error: messageOf(error, "Could not load the comparison."),
      comparison: null,
    };
  }
}

// Comparisons load with the change list, with nothing to click.
watch(
  edits,
  (next) => {
    updateSelection(next);
    for (const edit of next) {
      if (edit.target && !comparisons.value[edit.key]) void loadComparison(edit);
    }
  },
  { immediate: true },
);

/* ------------------------------------------------- state */

/** The developer's checkout: the details for developers name Git. */
const isTree = computed(() => status.value?.owner === "developer");
const sync = computed(() => status.value?.sync ?? null);

/** Publications made here that did not reach the website — also after a restart. */
const waitingToSend = computed(
  () => isTree.value && (pendingPush.value !== null || (status.value?.unpushed?.mica ?? 0) > 0),
);
/** Work in the developer's checkout that Publish would send too, so it waits. */
const otherWork = computed(() => (isTree.value ? (status.value?.unpushed?.other ?? 0) : 0));
/** The developer's checkout on no branch, as a content submodule usually is: Publish waits for the developer. */
const detached = computed(() => (isTree.value ? (status.value?.detached ?? null) : null));

const canPublish = computed(
  () =>
    (status.value?.publish.enabled ?? false) &&
    chosen.value.length > 0 &&
    summary.value.trim() !== "" &&
    otherWork.value === 0 &&
    detached.value === null &&
    !publishing.value,
);

const stateWord: Record<Edit["state"], string> = {
  new: "New",
  changed: "Changed",
  removed: "Will be removed",
};

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
  published.value = null;
  try {
    // Exactly what the editor sees here, at the revision they see it: a file
    // saved again since makes the server refuse rather than publish it unseen.
    const pages = pagesOf(chosen.value);
    const outcome = await api.staging.publish(summary.value.trim(), reviewedPaths(chosen.value, shownRevisions));
    typed.value = null;

    if (outcome.state === "published") {
      pendingPush.value = null;
      published.value = { revision: outcome.revision, pages };
    } else if (isTree.value) {
      // Only the sending failed. Keep "Try again" visible: Publish again would
      // publish nothing new.
      pendingPush.value = outcome;
      toast.error("Published here, but not sent to the website.", outcome.pushError);
    } else {
      toast.error("Published in Mica, not on the website yet.", "Mica tries again every minute.");
    }

    await staging.refresh();
  } catch (error) {
    if (error instanceof ApiError) {
      toast.error(error.message, error.issues[0]?.message);
      // A conflict or a validation refusal means the list moved: show the truth, comparisons included.
      await refresh();
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
      published.value = { revision: outcome.revision, pages: [] };
    } else {
      pendingPush.value = outcome;
      toast.error("It could not be sent again.", outcome.pushError);
    }
    await staging.refresh();
  } catch (error) {
    toast.error(messageOf(error, "Could not send it to the website."));
  } finally {
    pushing.value = false;
  }
}

async function discard(): Promise<void> {
  const edit = discardTarget.value;
  if (!edit) return;

  discarding.value = true;
  try {
    await api.staging.discard(reviewedPaths([edit], shownRevisions));
    toast.success(`Discarded the changes to ${edit.label}.`);
    discardTarget.value = null;
    await staging.refresh();
  } catch (error) {
    toast.error(messageOf(error, "Could not discard."));
    // Someone saved again: show their version before anything is discarded.
    if (error instanceof ApiError && error.status === 409) {
      discardTarget.value = null;
      await refresh();
    }
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
    toast.error(messageOf(error, "Could not reach the website's files."));
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
      error: messageOf(error, "Could not load the comparison."),
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

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
</script>

<template>
  <PageHeader title="Publish" subtitle="Saved changes that are not on the website yet">
    <button type="button" class="btn-ghost px-2" :disabled="loading" @click="refresh">
      <RefreshCw :size="16" aria-hidden="true" />
      <span class="sr-only">Refresh the list of changes</span>
    </button>
  </PageHeader>

  <div class="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6">
    <StatusNotice v-if="loading" kind="loading" />

    <!-- An old list is not the pending changes: Publish would be refused for it. -->
    <StatusNotice v-else-if="staging.error.value" kind="error" title="The changes could not be loaded" :message="staging.error.value" @retry="refresh" />

    <template v-else-if="status">
      <div v-if="published" role="status" class="rounded-md border border-success/15 bg-success-soft p-4">
        <p class="text-sm font-medium text-success">Published</p>
        <p class="mt-1 text-xs text-muted">
          Your website is being rebuilt now. This usually takes a few minutes.
        </p>
        <ul v-if="published.pages.length" class="mt-2 space-y-1 text-sm">
          <li v-for="item in published.pages" :key="item.href">
            <a :href="item.href" target="_blank" rel="noopener noreferrer" class="font-medium text-accent underline underline-offset-2">
              Open {{ item.label }} on the website<span class="sr-only"> (opens a new tab)</span>
            </a>
          </li>
        </ul>
        <DeveloperDetails v-if="published.revision">
          <p>Commit <span class="font-mono">{{ short(published.revision) }}</span>.</p>
        </DeveloperDetails>
      </div>

      <ModelNotice />

      <!-- Publishing unavailable: still an honest, read-only list. -->
      <div
        v-if="!status.publish.enabled"
        class="rounded-md border border-line bg-subtle p-4 text-sm text-muted"
      >
        <p class="font-medium text-ink">Publishing is not available here</p>
        <p class="mt-1">{{ status.publish.reason }}</p>
      </div>

      <!-- Mica's own clone: shown only when something needs attention. -->
      <template v-if="sync">
        <div v-if="sync.error" role="alert" class="rounded-md border border-warning/15 bg-warning-soft p-4">
          <p class="text-sm font-medium text-warning">Mica cannot bring in the website's latest version since {{ since(sync.error.since) }}</p>
          <p class="mt-1 text-xs text-muted">
            You can go on saving. Mica tries again every minute. If this stays, tell the person who runs Mica:
            {{ sync.error.message }}
          </p>
          <button type="button" class="btn-secondary mt-2.5" :disabled="syncing" @click="syncNow">
            {{ syncing ? "Trying…" : "Try again" }}
          </button>
        </div>

        <div v-if="sync.pendingPush" role="status" class="rounded-md border border-line bg-subtle p-4">
          <p class="text-sm font-medium">Published in Mica, not on the website yet</p>
          <p class="mt-1 text-xs text-muted">
            Mica tries again every minute. If this stays, tell the person who runs Mica:
            {{ sync.pendingPush.reason }}
          </p>
        </div>

        <div v-if="sync.refused" role="alert" class="rounded-md border border-danger/15 bg-danger-soft p-4">
          <p class="text-sm font-medium text-danger">The last publication was refused</p>
          <p class="mt-1 text-xs text-muted">
            Its changes are listed below again. Tell the person who runs Mica: {{ sync.refused.reason }}
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

      <!-- The developer's checkout: a publication that did not reach the website. -->
      <div v-if="waitingToSend" role="alert" class="rounded-md border border-warning/15 bg-warning-soft p-4">
        <p class="text-sm font-medium text-warning">Published here, but not sent to the website yet</p>
        <p class="mt-1 text-xs text-muted">
          {{ pendingPush?.pushError ?? "Try again to send it. Nothing is published twice." }}
        </p>
        <button type="button" class="btn-secondary mt-2.5" :disabled="pushing" @click="retryPush">
          {{ pushing ? "Sending…" : "Try again" }}
        </button>
        <DeveloperDetails>
          <p>The commit is in your checkout. "Try again" runs <code>git push</code> and never commits again.</p>
        </DeveloperDetails>
      </div>

      <div v-if="detached" role="alert" class="rounded-md border border-warning/15 bg-warning-soft p-4">
        <p class="text-sm font-medium text-warning">Publishing waits for the developer</p>
        <p class="mt-1 text-xs text-muted">
          The content folder is not ready to publish yet. You can go on saving. Ask the developer to set it up, then
          publish.
        </p>
        <DeveloperDetails>
          <p>
            The {{ detached.superproject ? "content submodule" : "repository" }} at
            <code>{{ detached.repository }}</code> is on a detached HEAD, so a commit would be on no branch. Check out
            the branch with <code>{{ detached.command }}</code>, then publish.
          </p>
        </DeveloperDetails>
      </div>

      <div v-if="otherWork > 0" role="alert" class="rounded-md border border-warning/15 bg-warning-soft p-4">
        <p class="text-sm font-medium text-warning">Publishing waits for other work</p>
        <p class="mt-1 text-xs text-muted">
          This copy of the website has {{ plural(otherWork, "change", "changes") }} that
          {{ otherWork === 1 ? "was" : "were" }} not made in Mica and {{ otherWork === 1 ? "is" : "are" }} not on the
          website yet. Publishing would send {{ otherWork === 1 ? "it" : "them" }} too.
        </p>
        <DeveloperDetails>
          <p>
            {{ plural(otherWork, "commit", "commits") }} on this branch {{ otherWork === 1 ? "is" : "are" }} on no
            remote. Push {{ otherWork === 1 ? "it" : "them" }} with <code>git push</code>, or move
            {{ otherWork === 1 ? "it" : "them" }} to another branch. Then publish.
          </p>
        </DeveloperDetails>
      </div>

      <div
        v-if="!status.validation.ok"
        role="alert"
        class="rounded-md border border-danger/15 bg-danger-soft p-4"
      >
        <p class="text-sm font-medium text-danger">Some changes cannot be published yet</p>
        <p class="mt-1 text-xs text-muted">Fix them, or publish the other changes without them.</p>
        <ul class="mt-1.5 space-y-1 text-xs text-danger">
          <li v-for="problem in status.validation.problems" :key="problem.path">
            <span class="font-medium">{{ problem.label }}</span>
            <template v-for="(issue, index) in problem.issues" :key="index">
              {{ index === 0 ? "—" : ";" }}
              <RouterLink
                v-if="fixLink(problem.path, issue.path)"
                :to="fixLink(problem.path, issue.path)!"
                class="underline underline-offset-2 hover:no-underline"
              >
                {{ issue.message }}
              </RouterLink>
              <template v-else>{{ issue.message }}</template>
            </template>
          </li>
        </ul>
      </div>

      <div v-if="edits.length === 0" class="card p-8 text-center">
        <p class="text-sm font-medium">Nothing waiting to be published</p>
        <p class="mt-1 text-sm text-muted">
          Saved changes collect here until somebody publishes them. Right now the website has
          everything.
        </p>
      </div>

      <section v-else aria-labelledby="changes-heading" class="space-y-2">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="changes-heading" class="text-sm font-semibold">
            {{ plural(edits.length, "saved change", "saved changes") }}
          </h2>
          <div v-if="status.publish.enabled && selectable.length > 1" class="flex gap-1">
            <button type="button" class="btn-ghost text-xs" @click="selectAll(true)">Select all</button>
            <button type="button" class="btn-ghost text-xs" @click="selectAll(false)">Select none</button>
          </div>
        </div>

        <ul class="card divide-y divide-line">
          <li v-for="edit in edits" :key="edit.key" class="flex items-start gap-3 p-4">
            <input
              v-if="status.publish.enabled"
              :id="`publish-${edit.key}`"
              type="checkbox"
              class="mt-1 h-4 w-4 shrink-0"
              :checked="selected.has(edit.key)"
              :disabled="blocked.has(edit.key) || publishing"
              :aria-label="`Publish ${edit.label}`"
              @change="toggle(edit.key)"
            />

            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-baseline gap-x-2">
                <component
                  :is="edit.link ? 'RouterLink' : 'p'"
                  v-bind="edit.link ? { to: edit.link } : {}"
                  :class="['text-sm font-medium', edit.link && 'hover:underline']"
                >
                  {{ edit.label }}
                </component>
                <span
                  :class="[
                    'text-xs',
                    edit.state === 'removed' ? 'text-danger' : edit.state === 'new' ? 'text-success' : 'text-muted',
                  ]"
                >
                  {{ stateWord[edit.state] }}
                </span>
                <span v-if="edit.savedAt" class="text-xs text-muted">
                  · saved {{ relativeTime(edit.savedAt) }}
                </span>
                <span
                  v-if="edit.key.startsWith('media:') && edit.state === 'new' && !neededKeys.has(edit.key)"
                  class="text-xs font-medium text-warning"
                >
                  · not in any field yet
                </span>
              </div>

              <p v-if="problems.has(edit.key)" class="mt-1 text-xs text-danger">
                Fix this first: {{ problems.get(edit.key)!.flatMap((problem) => problem.issues.map((issue) => issue.message)).join("; ") }}
              </p>
              <p v-else-if="blocked.has(edit.key)" class="mt-1 text-xs text-danger">
                It uses something that must be fixed first.
              </p>
              <p v-if="edit.needs.length > 0" class="mt-1 text-xs text-muted">
                Published together with {{ edit.needs.map((key) => labelOf.get(key) ?? key).join(", ") }}, which it uses.
              </p>

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

      <section v-if="edits.length > 0 && status.publish.enabled" class="card p-4" aria-labelledby="publish-heading">
        <h2 id="publish-heading" class="text-sm font-semibold">
          {{ chosen.length === 0 ? "Choose the changes to publish" : `Publish ${plural(chosen.length, "change", "changes")}` }}
        </h2>
        <p class="mt-1 text-xs text-muted">
          The website is rebuilt after you publish. Changes that you do not choose stay saved here.
        </p>

        <form class="mt-3 space-y-2" @submit.prevent="canPublish && publish()">
          <label for="publish-summary" class="field-label">Say what changed</label>
          <div class="flex flex-wrap items-center gap-2">
            <input
              id="publish-summary"
              v-model="summary"
              type="text"
              class="input min-w-0 flex-1"
              maxlength="500"
              :disabled="publishing"
            />
            <button type="submit" class="btn-primary" :disabled="!canPublish">
              {{ publishing ? "Publishing…" : "Publish" }}
            </button>
          </div>
        </form>

        <DeveloperDetails>
          <p v-if="isTree">
            One commit of the chosen files<template v-if="status.branch"> on branch <span class="font-mono">{{ status.branch }}</span></template><template v-if="status.head">, after <span class="font-mono">{{ short(status.head) }}</span></template>,
            pushed with your own Git configuration. The summary is the commit message.
          </p>
          <p v-else>
            One commit of the chosen files to the content repository, which starts your website's build. The summary
            is the commit message.
          </p>
        </DeveloperDetails>
      </section>
    </template>

    <p v-else class="text-sm text-muted">The list of changes could not be loaded. Reload to try again.</p>
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
    <p>
      This puts it back as it was at the last publication: something new is deleted, and something changed or
      removed comes back. It cannot be undone.
    </p>
  </ConfirmDialog>
</template>
