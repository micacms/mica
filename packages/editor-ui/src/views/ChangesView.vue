<script setup lang="ts">
/**
 * The saved changes that are not on the website yet, and Publish. The review
 * itself is `usePublishReview`; the conflicts of Mica's own clone are
 * `SyncConflicts`. `owner` changes only the developer details, not the words.
 */

import { computed, onMounted } from "vue";
import { RefreshCw } from "@lucide/vue";

import type { FileChange } from "@/api";
import ChangeComparison from "@/components/ChangeComparison.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import DeveloperDetails from "@/components/DeveloperDetails.vue";
import ModelNotice from "@/components/ModelNotice.vue";
import PageHeader from "@/components/PageHeader.vue";
import StatusNotice from "@/components/StatusNotice.vue";
import SyncConflicts from "@/components/SyncConflicts.vue";
import { usePublishReview } from "@/composables/usePublishReview";
import type { Edit } from "@/lib/edits";
import { relativeTime } from "@/lib/format";
import { useStaging } from "@/stores/staging";

const staging = useStaging();
const {
  status,
  edits,
  loading,
  publishing,
  pushing,
  syncing,
  discarding,
  discardTarget,
  published,
  pendingPush,
  problems,
  blocked,
  labelOf,
  neededKeys,
  fixLink,
  selected,
  chosen,
  selectable,
  toggle,
  selectAll,
  summary,
  comparisons,
  observeComparison,
  fieldsFor,
  isTree,
  waitingToSend,
  otherWork,
  detached,
  canPublish,
  refresh,
  publish,
  retryPush,
  discard,
  syncNow,
} = usePublishReview();

const sync = computed(() => status.value?.sync ?? null);

onMounted(refresh);

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

        <SyncConflicts :conflicts="sync.conflicts" :refresh="refresh" />
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

      <div v-if="status.ignored.length > 0" role="alert" class="rounded-md border border-warning/15 bg-warning-soft p-4">
        <p class="text-sm font-medium text-warning">Some saved content never reaches the website</p>
        <p class="mt-1 text-xs text-muted">
          The website's setup leaves it out of every publication, so it is not in the list below. It stays saved. Ask the
          developer to include it.
        </p>
        <DeveloperDetails>
          <p>A <code>.gitignore</code> rule matches these paths in the content folder, so Git never commits them:</p>
          <ul class="list-inside list-disc">
            <li v-for="path in status.ignored" :key="path"><code>{{ path }}</code></li>
          </ul>
          <p>Remove the rule, or move the content out of its reach.</p>
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
              <div v-if="edit.target" :ref="observeComparison(edit.key, edit.target)">
                <p v-if="!comparisons[edit.key] || comparisons[edit.key]?.loading" class="mt-2 text-xs text-muted">
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
              </div>

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
