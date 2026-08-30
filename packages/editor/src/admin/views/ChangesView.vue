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
 * The two workspaces speak through one API and differ only in what the words
 * mean physically: a working tree lists `git status` and publishes through the
 * developer's own Git; a draft store lists staged rows and publishes one
 * provider-side commit. The `workspace` field decides the phrasing, never the
 * behaviour.
 */

import { computed, onMounted, ref } from "vue";
import { RefreshCw } from "@lucide/vue";

import { api, ApiError, type PendingChange, type PublishOutcome } from "@/api";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import PageHeader from "@/components/PageHeader.vue";
import { useStaging } from "@/stores/staging";
import { useToast } from "@/stores/toast";

const staging = useStaging();
const toast = useToast();

const loading = ref(true);
const publishing = ref(false);
const pushing = ref(false);
const message = ref("");
const discardTarget = ref<Group | null>(null);
const discarding = ref(false);

/** The half-finished publication, when a local push failed. */
const pendingPush = ref<PublishOutcome | null>(null);

const status = staging.status;

interface Group {
  key: string;
  label: string;
  link: { name: string; params?: Record<string, string> } | null;
  changes: PendingChange[];
}

/**
 * One row per thing an editor recognises — an entry, a singleton, the shared
 * media folder — rather than one per file. An entry is several files, and
 * "index.json, body.mdoc, media/photo.jpg" is the repository's view of what
 * the editor knows as one article.
 */
const groups = computed<Group[]>(() => {
  const byKey = new Map<string, Group>();

  for (const change of status.value?.changes ?? []) {
    const owner = change.owner;
    const key =
      owner.kind === "entry"
        ? `entry:${owner.collection}/${owner.slug}`
        : owner.kind === "singleton"
          ? `singleton:${owner.name}`
          : owner.kind === "order"
            ? `order:${owner.collection}`
            : owner.kind === "media"
              ? "media"
              : `other:${change.path}`;

    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        label: owner.label,
        link:
          owner.kind === "entry" && change.kind !== "delete"
            ? { name: "entry", params: { collection: owner.collection, slug: owner.slug } }
            : owner.kind === "singleton"
              ? { name: "singleton", params: { name: owner.name } }
              : owner.kind === "media"
                ? { name: "media" }
                : null,
        changes: [],
      };
      byKey.set(key, group);
    }
    group.changes.push(change);
  }

  return [...byKey.values()];
});

const workspace = computed(() => status.value?.workspace ?? "draft-store");
const isTree = computed(() => workspace.value === "working-tree");

const subtitle = computed(() => {
  if (!status.value) return null;
  if (isTree.value) {
    return status.value.branch
      ? `Your working tree, on branch ${status.value.branch}`
      : "Your working tree";
  }
  return "Saved in Mica, waiting to be published";
});

/** Commits already made and not yet pushed — visible even across a restart. */
const waitingToPush = computed(
  () => pendingPush.value !== null || (isTree.value && (status.value?.ahead ?? 0) > 0),
);

const canPublish = computed(
  () =>
    (status.value?.publish.enabled ?? false) &&
    (status.value?.validation.ok ?? false) &&
    (status.value?.changes.length ?? 0) > 0 &&
    !publishing.value,
);

const kindWord: Record<PendingChange["kind"], string> = {
  create: "Added",
  update: "Changed",
  delete: "Removed",
};

async function refresh(): Promise<void> {
  await staging.refresh();
  loading.value = false;
}

onMounted(refresh);

async function publish(): Promise<void> {
  publishing.value = true;
  try {
    const outcome = await api.staging.publish(message.value, status.value?.baseRevision ?? null);

    if (outcome.state === "published") {
      pendingPush.value = null;
      message.value = "";
      toast.success("Published.", outcome.revision ? `Commit ${short(outcome.revision)}.` : undefined);
    } else {
      // The commit is real; only the push failed. Say so, and keep the retry
      // visible — pressing Publish again must not create a second commit.
      pendingPush.value = outcome;
      message.value = "";
      toast.error("Committed, but the push failed.", outcome.pushError);
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
  const group = discardTarget.value;
  if (!group) return;

  discarding.value = true;
  try {
    await api.staging.discard(group.changes.map((change) => change.path));
    toast.success(`Discarded the changes to ${group.label}.`);
    discardTarget.value = null;
    await staging.refresh();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not discard.");
  } finally {
    discarding.value = false;
  }
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
        class="rounded-md border border-line bg-stone p-4 text-sm text-muted"
      >
        <p class="font-medium text-ink">Publishing is not available here</p>
        <p class="mt-1">{{ status.publish.reason }}</p>
      </div>

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
      <div v-if="groups.length === 0" class="card p-8 text-center">
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
          <li v-for="group in groups" :key="group.key" class="flex items-start gap-3 p-4">
            <div class="min-w-0 flex-1">
              <component
                :is="group.link ? 'RouterLink' : 'p'"
                v-bind="group.link ? { to: group.link } : {}"
                :class="['text-sm font-medium', group.link && 'hover:underline']"
              >
                {{ group.label }}
              </component>

              <ul class="mt-1 space-y-0.5">
                <li
                  v-for="change in group.changes"
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

            <button type="button" class="btn-ghost shrink-0 text-xs" @click="discardTarget = group">
              Discard
            </button>
          </li>
        </ul>
      </section>

      <!-- Publish -->
      <section v-if="groups.length > 0 && status.publish.enabled" class="card p-4" aria-labelledby="publish-heading">
        <h2 id="publish-heading" class="text-sm font-semibold">
          Publish {{ groups.length === 1 ? "this change" : `these ${groups.length} changes` }}
        </h2>

        <p class="mt-1 text-xs text-muted">
          {{
            isTree
              ? "One commit of exactly the files listed above, pushed with your own Git configuration."
              : "One commit to the content repository, which is what triggers your site's build."
          }}
          <template v-if="status.baseRevision"> Based on {{ short(status.baseRevision) }}.</template>
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
