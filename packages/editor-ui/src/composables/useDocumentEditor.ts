/**
 * The form of an entry or of settings: load, edit, check, save. Saved is not
 * Published: a save joins the pending changes, and unsaved work stays in the
 * form, and in this tab (`useKeptChanges`). The revision goes back with the
 * save, so a concurrent save gets a 409 instead of an overwrite
 * (`useSaveConflict`). The views keep only what differs, such as the URL of an
 * entry and its delete.
 */

import { computed, nextTick, ref, shallowRef } from "vue";
import { useRoute } from "vue-router";

import type { FieldMap } from "@micacms/core/internal";

import { ApiError, messageOf } from "@/api";
import { fieldPathOf, useFormIssues } from "@/composables/useFormIssues";
import { useKeptChanges } from "@/composables/useKeptChanges";
import { useSaveConflict, type SaveBasis, type SavedVersion } from "@/composables/useSaveConflict";
import { useUnsavedChanges } from "@/composables/useUnsavedChanges";
import { focusField } from "@/lib/focus";
import { useStaging } from "@/stores/staging";
import { useToast } from "@/stores/toast";

/** What differs between an entry and settings. */
export interface DocumentSource<Version extends SavedVersion, Saved extends { revision: string }> {
  /** "this entry", "these settings": for the messages. */
  noun: string;
  /** Where this tab keeps the unsaved values. */
  key: () => string;
  /** The key of its edit in the pending changes; null while it is not saved yet. */
  editKey: () => string | null;
  fields: () => FieldMap | undefined;
  readOnly: () => boolean;
  /** Reads the saved version. Null for a document that is not saved yet. */
  read: (() => Promise<Version>) | null;
  /** The form's values for saved data, or for a new document (`null`). */
  values: (data: Record<string, unknown> | null) => Record<string, unknown>;
  write: (data: Record<string, unknown>, basis: SaveBasis) => Promise<Saved>;
  /** After a save: says so. False when the view moved to another page, so there is nothing to read back. */
  saved: (result: Saved) => Promise<boolean>;
  /** The message for a 409 on a new document. */
  duplicate?: string;
}

export function useDocumentEditor<Version extends SavedVersion, Saved extends { revision: string }>(
  source: DocumentSource<Version, Saved>,
) {
  const route = useRoute();
  const staging = useStaging();
  const toast = useToast();

  const values = ref<Record<string, unknown>>({});
  /** The version this form was opened against; `null` on a new document, so a duplicate is a conflict. */
  const revision = ref<string | null>(null);
  /** The saved version that the form shows, as the server sent it. */
  const version = shallowRef<Version | null>(null);
  const loading = ref(true);
  /** Why it could not be loaded. The form then stays hidden: an empty form would save over it. */
  const loadError = ref<string | null>(null);
  const saving = ref(false);
  const isNew = source.read === null;

  const form = useFormIssues(source.fields, values);
  const unsaved = useUnsavedChanges(values);
  const dirty = unsaved.dirty;
  // Kept in this tab, so that signing in again after the session ended loses nothing.
  const kept = useKeptChanges(source.key, values, revision, unsaved);
  const conflict = useSaveConflict<Version>(() => (source.read ? source.read() : Promise.reject(new Error("Not saved yet."))));

  /** Its saved changes that are not on the website yet. */
  const pending = computed(() => {
    const key = source.editKey();
    return (key && staging.edits.value.find((edit) => edit.key === key)) || null;
  });

  const state = computed(() =>
    isNew
      ? { label: "Not saved yet", tone: "status-unsaved" }
      : dirty.value
        ? { label: "Unsaved changes", tone: "status-unsaved" }
        : pending.value
          ? { label: "Saved · not published", tone: "status-draft" }
          : staging.knowsPublished.value
            ? { label: "Published", tone: "status-published" }
            : { label: "Saved", tone: "" },
  );

  function setBaseline(next: Version | null): void {
    version.value = next;
    values.value = structuredClone(source.values(next?.data ?? null));
    revision.value = next?.revision ?? null;
    form.reset();
    conflict.clear();
    unsaved.markClean();
  }

  /** Loads the form, and offers what this tab kept from before. */
  async function load(): Promise<boolean> {
    loading.value = true;
    loadError.value = null;
    try {
      // A new document starts as a full skeleton so every input is bound. The skeleton is not an edit.
      setBaseline(source.read ? await source.read() : null);
      kept.check();
      return true;
    } catch (error) {
      loadError.value = messageOf(error, `Could not load ${source.noun}.`);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /** The first load. From a problem on the Publish page, it goes on to its field. */
  async function open(): Promise<boolean> {
    const loaded = await load();
    const field = route.query["field"];
    if (loaded && typeof field === "string") {
      await nextTick();
      focusField(field);
    }
    return loaded;
  }

  /** Opens the saved version again and forgets what this tab kept: after a discard, or for "Use theirs". */
  async function reopen(success?: string): Promise<void> {
    kept.forget();
    if (!source.read) return;
    try {
      setBaseline(await source.read());
      if (success) toast.success(success);
    } catch (error) {
      toast.error(messageOf(error, `Could not load ${source.noun}.`));
    }
  }

  /** Checks a field when the editor leaves it. */
  function onLeave(event: FocusEvent): void {
    const path = fieldPathOf(event.target);
    if (path) form.leave(path);
  }

  /** Shows the problems and moves to the first one. */
  async function showIssues(): Promise<void> {
    await nextTick();
    const first = form.issues.value[0];
    if (first) focusField(first.path);
  }

  /** Reads back what the server wrote, such as the keys it gave to new rows (#220), unless the editor typed on meanwhile. */
  async function readBack(): Promise<void> {
    if (!source.read) return;
    try {
      const saved = await source.read();
      if (!dirty.value) setBaseline(saved);
    } catch {
      // The save is done; the next one goes at the revision it gave.
    }
  }

  /** `keepMine`: save over the colleague's version that the conflict shows. */
  async function save(options: { keepMine?: boolean } = {}): Promise<void> {
    // Enter in a read-only field still submits the form while a save runs.
    if (source.readOnly() || saving.value) return;
    unsaved.flush();
    if (!form.checkAll()) {
      toast.error("Some fields need attention before you can save.");
      await showIssues();
      return;
    }
    saving.value = true;
    const basis = conflict.basis(revision.value, options.keepMine);
    const send = () => source.write(values.value, basis);

    try {
      // Nothing is saved yet to compare with: a 409 is a duplicate.
      const outcome = isNew ? { kind: "done" as const, result: await send() } : await conflict.run(revision.value, send);
      if (outcome.kind === "refused") toast.error(outcome.message);
      if (outcome.kind !== "done") return;

      revision.value = outcome.result.revision;
      unsaved.markClean();
      kept.forget();
      void staging.refresh();
      if (await source.saved(outcome.result)) await readBack();
    } catch (error) {
      if (error instanceof ApiError && error.code === "conflict") {
        toast.error(source.duplicate ?? error.message);
      } else if (error instanceof ApiError && error.issues.length > 0) {
        form.set(error.issues);
        toast.error(error.message, `${error.issues.length} field(s) need attention.`);
        await showIssues();
      } else {
        toast.error(messageOf(error, `Could not save ${source.noun}.`));
      }
    } finally {
      saving.value = false;
    }
  }

  return {
    values,
    revision,
    version,
    loading,
    loadError,
    saving,
    isNew,
    issues: form.issues,
    dirty,
    unsaved,
    kept,
    conflict,
    pending,
    state,
    open,
    load,
    reopen,
    onLeave,
    save,
  };
}
