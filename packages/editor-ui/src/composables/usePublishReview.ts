/**
 * The review on the Publish page: the saved changes, which of them to publish
 * now, their comparisons, and Publish, "Try again" and Discard. The whole site
 * shares the changes; the editor chooses, and the rest stays saved. Publish
 * and Discard send the revisions of the comparisons on the page, or of the list
 * for a comparison that did not load yet, so a file saved again since is
 * refused, not published unseen.
 */

import { computed, ref, watch } from "vue";

import { api, ApiError, messageOf, type PublishOutcome } from "@/api";
import { useComparisons } from "@/composables/useComparisons";
import { blockedEdits, problemsByEdit, publishSummary, reviewedPaths, shownRevisions, withNeeds, withoutDependents, type Edit } from "@/lib/edits";
import { pageOfOwner } from "@/lib/pages";
import { useSchema } from "@/stores/schema";
import { useStaging } from "@/stores/staging";
import { useToast } from "@/stores/toast";

export interface PublishedPage {
  label: string;
  href: string;
}

export function usePublishReview() {
  const schema = useSchema();
  const staging = useStaging();
  const toast = useToast();
  const status = staging.status;
  /** One row per edit, never per file — see `lib/edits.ts`. */
  const edits = staging.edits;

  const loading = ref(true);
  const publishing = ref(false);
  const pushing = ref(false);
  const syncing = ref(false);
  const discarding = ref(false);
  const discardTarget = ref<Edit | null>(null);
  /** The last publication on this page, for the success panel. */
  const published = ref<{ revision: string | null; pages: PublishedPage[] } | null>(null);
  /** A publication in the developer's checkout that did not reach the website. */
  const pendingPush = ref<PublishOutcome | null>(null);

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
  const chosen = computed(() => edits.value.filter((edit) => selected.value.has(edit.key)));
  const selectable = computed(() => edits.value.filter((edit) => !blocked.value.has(edit.key)));

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

  /** The summary: Mica's suggestion until the editor types their own. */
  const typed = ref<string | null>(null);
  const summary = computed({
    get: () => typed.value ?? publishSummary(chosen.value),
    set: (value: string) => {
      typed.value = value;
    },
  });

  /* ------------------------------------------------- before/after */

  // A comparison loads when its row comes near the screen (`observeComparison`), with nothing to click.
  const comparisons = useComparisons();
  /** The revisions that Publish and Discard send: those of the comparison on the page, not a newer list's. */
  const shownRevisionsOf = (edit: Edit) => shownRevisions(comparisons.items.value[edit.key]);

  watch(edits, updateSelection, { immediate: true });

  /* ------------------------------------------------- state */

  /** The developer's checkout: the details for developers name Git. */
  const isTree = computed(() => status.value?.owner === "developer");
  /** Publications made here that did not reach the website — also after a restart. */
  const waitingToSend = computed(() => isTree.value && (pendingPush.value !== null || (status.value?.unpushed?.mica ?? 0) > 0));
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

  /* ------------------------------------------------- actions */

  async function refresh(): Promise<void> {
    // Forget the comparisons first, so that each one loads again against the refreshed change set.
    comparisons.clear();
    await staging.refresh();
    loading.value = false;
  }

  /** The pages that the chosen changes show on, before Publish takes them off the list. */
  function pagesOf(chosenEdits: Edit[]): PublishedPage[] {
    const pages = new Map<string, string>();
    for (const edit of chosenEdits) {
      if (edit.state === "removed") continue;
      const owner = edit.fileChanges[0]?.owner;
      const href = owner ? pageOfOwner(owner, schema.schema.value) : null;
      if (href) pages.set(href, edit.label);
    }
    return [...pages].map(([href, label]) => ({ label, href }));
  }

  async function publish(): Promise<void> {
    publishing.value = true;
    published.value = null;
    try {
      // Exactly what the editor sees here, at the revision they see it.
      const pages = pagesOf(chosen.value);
      const outcome = await api.staging.publish(summary.value.trim(), reviewedPaths(chosen.value, shownRevisionsOf));
      typed.value = null;

      if (outcome.state === "published") {
        pendingPush.value = null;
        published.value = { revision: outcome.revision, pages };
      } else if (isTree.value) {
        // Only the sending failed. Keep "Try again" visible: Publish again would publish nothing new.
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
      await api.staging.discard(reviewedPaths([edit], shownRevisionsOf));
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

  /** Mica's own clone: brings in the website's latest version now. */
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

  return {
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
    comparisons: comparisons.items,
    observeComparison: comparisons.observe,
    fieldsFor: comparisons.fieldsFor,
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
  };
}
