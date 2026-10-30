/**
 * The form of an entry or of settings: load, edit, check, save. Saved is not
 * Published: a save joins the pending changes. The revision goes back with the
 * save, so a concurrent save gets a 409 instead of an overwrite
 * (`useSaveConflict`). The views keep only what differs, such as the ID of an
 * entry and its delete.
 *
 * A saved document saves by itself: after a pause in typing, when the editor
 * leaves a field, and when the form closes. A new document waits for its first
 * save, and a held field, such as a new URL, waits for its button: autosave
 * writes its saved value. What autosave cannot save (a field that breaks a
 * rule, a failed save, a conflict) stays in the form and in this tab
 * (`useKeptChanges`), and leaving asks first.
 */

import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useRoute } from "vue-router";

import { ROW_KEY, validateFields, type FieldMap } from "@micacms/core/internal";

import { ApiError, messageOf } from "@/api";
import { fieldPathOf, useFormIssues } from "@/composables/useFormIssues";
import { useKeptChanges } from "@/composables/useKeptChanges";
import { useSaveConflict, type ConflictState, type SaveBasis, type SavedVersion } from "@/composables/useSaveConflict";
import { useUnsavedChanges } from "@/composables/useUnsavedChanges";
import { debounce } from "@/lib/debounce";
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
  /** After a save: says so, unless it was an autosave. False when the view moved to another page, so there is nothing to read back. */
  saved: (result: Saved, auto: boolean) => Promise<boolean>;
  /** The message for a 409 on a new document. */
  duplicate?: string;
  /** The element around the form: a form and its overlay can show the same field. */
  root?: () => ParentNode | null;
  /** A field whose change waits for a button, such as a new URL: autosave writes its saved value. Null while none waits. */
  heldField?: () => string | null;
}

/**
 * The save state of a form. `waiting`: the rest is saved, and a held field waits for its button.
 * `invalid`: a value breaks a rule, so autosave waits. `message`: why the save failed.
 */
export interface SaveState {
  kind: "new" | "saving" | "saved" | "waiting" | "invalid" | "failed" | "conflict";
  label: string;
  /** The `status-*` utility of the pill; empty for the neutral one. */
  tone: string;
  message?: string;
}

/** Whether the work in the form is safe. Whether it waits to be published is the pending edit's part. */
export function saveStateOf(form: {
  isNew: boolean;
  conflict: ConflictState;
  /** A save runs, or autosave writes the changes after the pause. */
  saving: boolean;
  failed: string | null;
  /** The form differs from what is saved. */
  changed: boolean;
  /** A held field waits for its button. */
  held: boolean;
}): SaveState {
  if (form.isNew) return { kind: "new", label: "Not saved yet", tone: "" };
  if (form.conflict === "loaded") return { kind: "conflict", label: "Not saved: choose a version", tone: "status-error" };
  if (form.conflict !== "none") return { kind: "conflict", label: "Not saved", tone: "status-error" };
  if (form.saving) return { kind: "saving", label: "Saving…", tone: "status-busy" };
  if (form.failed) return { kind: "failed", label: "Not saved", tone: "status-error", message: form.failed };
  if (form.changed) return { kind: "invalid", label: "Not saved: check the fields", tone: "status-warning" };
  if (form.held) return { kind: "waiting", label: "Saved · new ID waits", tone: "" };
  return { kind: "saved", label: "Saved", tone: "status-success" };
}

/** The pause in typing after which a document saves by itself. */
const AUTOSAVE_MS = 800;

const plain = (data: Record<string, unknown>): Record<string, unknown> => JSON.parse(JSON.stringify(data)) as Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * `local` with the keys that the server gave to its new rows (#220), and no other
 * change: an autosave must not put the server's form of a value, such as a
 * trimmed text, into the field that the editor types in.
 */
export function withRowKeys(fields: FieldMap, local: Record<string, unknown>, saved: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...local };
  for (const [key, field] of Object.entries(fields)) {
    const mine = local[key];
    const theirs = saved[key];
    if (field.kind === "object" && isRecord(mine) && isRecord(theirs)) result[key] = withRowKeys(field.fields, mine, theirs);
    if (field.kind === "repeater" && Array.isArray(mine) && Array.isArray(theirs) && mine.length === theirs.length) {
      result[key] = mine.map((row, index) => {
        const other: unknown = theirs[index];
        if (!isRecord(row) || !isRecord(other)) return row;
        const nested = withRowKeys(field.fields, row, other);
        return nested[ROW_KEY] === undefined && other[ROW_KEY] !== undefined ? { ...nested, [ROW_KEY]: other[ROW_KEY] } : nested;
      });
    }
  }
  return result;
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
  /** A save with a button runs: the form takes no input meanwhile. An autosave leaves it open. */
  const busy = ref(false);
  const isNew = source.read === null;

  const form = useFormIssues(source.fields, values);
  const unsaved = useUnsavedChanges(values, () => saveOnLeave());
  const dirty = unsaved.dirty;
  // Kept in this tab, so that signing in again after the session ended loses nothing.
  const kept = useKeptChanges(source.key, values, revision, unsaved);
  const conflict = useSaveConflict<Version>(() => (source.read ? source.read() : Promise.reject(new Error("Not saved yet."))));

  /** Its saved changes that are not on the website yet. */
  const pending = computed(() => {
    const key = source.editKey();
    return (key && staging.edits.value.find((edit) => edit.key === key)) || null;
  });

  /** The values as they were last loaded or saved: a held field keeps its saved value in an autosave. */
  let savedValues: Record<string, unknown> = {};
  /** Why the last autosave failed, or null. The next change, or "Try again", tries again. */
  const failed = ref<string | null>(null);
  /** The last autosave found a value outside the model's rules. The next change tries again. */
  const invalid = ref(false);
  /** False once the form has closed: a save that ends later reports in a message. */
  let mounted = true;

  /** What autosave writes: the form, with a held field at its saved value. */
  function autoData(): Record<string, unknown> {
    const held = source.heldField?.() ?? null;
    return held ? { ...values.value, [held]: savedValues[held] } : values.value;
  }

  /** Whether autosave may write now: a saved document, no conflict, no failure, no value outside the rules. */
  const autosaves = computed(
    () =>
      !isNew &&
      !source.readOnly() &&
      !loading.value &&
      !loadError.value &&
      !failed.value &&
      !invalid.value &&
      conflict.state.value === "none",
  );
  /** Every value within the model's rules. Checked at a save, not at each keystroke: a large document is slow to check. */
  function valid(): boolean {
    const fields = source.fields();
    return !fields || validateFields(fields, autoData(), { enforceRequired: false }).ok;
  }
  /** Changes that autosave writes when it can. */
  const changed = computed(() => !unsaved.isSaved(autoData()));
  /** Changes that leaving would lose: autosave cannot write them, or a held field waits for its button. */
  function atRisk(): boolean {
    unsaved.flush();
    return dirty.value && (!autosaves.value || JSON.stringify(autoData()) !== JSON.stringify(values.value) || !valid());
  }

  const state = computed(() =>
    saveStateOf({
      isNew,
      conflict: conflict.state.value,
      saving: saving.value || (changed.value && autosaves.value),
      failed: failed.value,
      changed: changed.value,
      held: !!source.heldField?.(),
    }),
  );

  function setBaseline(next: Version | null): void {
    version.value = next;
    values.value = structuredClone(source.values(next?.data ?? null));
    savedValues = plain(values.value);
    revision.value = next?.revision ?? null;
    failed.value = null;
    invalid.value = false;
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

  const focus = (path: string) => focusField(path, source.root?.() ?? document);

  /** The first load. It goes on to `field`: by default the one in the address, from a problem on the Publish page. */
  async function open(field: unknown = route.query["field"]): Promise<boolean> {
    const loaded = await load();
    if (loaded && typeof field === "string") {
      await nextTick();
      focus(field);
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

  /** Checks a field when the editor leaves it, and saves what it changed. */
  function onLeave(event: FocusEvent): void {
    const path = fieldPathOf(event.target);
    if (path) form.leave(path);
    unsaved.flush();
    autosaveSoon.flush();
  }

  /** Shows the problems and moves to the first one. */
  async function showIssues(): Promise<void> {
    await nextTick();
    const first = form.issues.value[0];
    if (first) focus(first.path);
  }

  /**
   * Reads back what the server wrote, unless the editor typed on meanwhile.
   * After a save with a button, the form takes the saved version. After an
   * autosave, only the keys of new rows (#220): the editor may still be typing.
   */
  async function readBack(sent: string, written: Record<string, unknown>, auto: boolean): Promise<void> {
    if (!source.read) return;
    try {
      const saved = await source.read();
      if (JSON.stringify(values.value) !== sent) return;
      const fields = source.fields();
      if (!auto || !fields) {
        setBaseline(saved);
        return;
      }
      const keyed = withRowKeys(fields, values.value, saved.data);
      if (JSON.stringify(keyed) === sent) return;
      savedValues = withRowKeys(fields, written, saved.data);
      unsaved.markClean(savedValues);
      values.value = keyed;
    } catch {
      // The save is done; the next one goes at the revision it gave.
    }
  }

  /** A change while a save runs: one more save after it. */
  let again = false;

  /** Writes `data`. An autosave reports a failure in the status; a save with a button, in a message. */
  async function write(data: Record<string, unknown>, options: { auto?: boolean; keepMine?: boolean } = {}): Promise<void> {
    saving.value = true;
    busy.value = !options.auto;
    const sent = JSON.stringify(values.value);
    const written = plain(data);
    const basis = conflict.basis(revision.value, options.keepMine);
    const send = () => source.write(written, basis);
    let done = false;

    try {
      // Nothing is saved yet to compare with: a 409 is a duplicate.
      const outcome = isNew ? { kind: "done" as const, result: await send() } : await conflict.run(revision.value, send);
      if (outcome.kind === "refused") {
        if (options.auto && mounted) failed.value = outcome.message;
        else toast.error(outcome.message);
      }
      // The form closed before a colleague's newer version came: their version waits, and the tab keeps these changes.
      if (outcome.kind === "conflict" && !mounted) toast.error(`Somebody else saved ${source.noun} meanwhile. Open it again to choose a version.`);
      if (outcome.kind !== "done") return;

      revision.value = outcome.result.revision;
      savedValues = written;
      failed.value = null;
      unsaved.markClean(written);
      done = true;
      if (!dirty.value) kept.forget();
      void staging.refresh();
      if (mounted && (await source.saved(outcome.result, !!options.auto))) await readBack(sent, written, !!options.auto);
    } catch (error) {
      if (error instanceof ApiError && error.code === "conflict") {
        toast.error(source.duplicate ?? error.message);
      } else if (!mounted) {
        // The form is gone: say so, and the tab offers the changes when it opens again.
        toast.error(messageOf(error, `Could not save ${source.noun}.`), "Open it again: Mica offers your changes.");
      } else if (error instanceof ApiError && error.issues.length > 0) {
        form.set(error.issues);
        if (options.auto) invalid.value = true;
        else {
          toast.error(error.message, `${error.issues.length} field(s) need attention.`);
          await showIssues();
        }
      } else if (options.auto) {
        failed.value = messageOf(error, `Could not save ${source.noun}.`);
      } else {
        toast.error(messageOf(error, `Could not save ${source.noun}.`));
      }
    } finally {
      saving.value = false;
      busy.value = false;
      // A change back to the values before this save planned no save, but differs from what it wrote.
      if (again || (done && mounted)) {
        again = false;
        void autosave();
      }
    }
  }

  /** Saves the changes that autosave may write, now. */
  async function autosave(): Promise<void> {
    autosaveSoon.cancel();
    unsaved.flush();
    if (!changed.value || !autosaves.value) return;
    if (!valid()) {
      invalid.value = true;
      return;
    }
    if (saving.value) {
      again = true;
      return;
    }
    await write(autoData(), { auto: true });
  }
  const autosaveSoon = debounce(() => void autosave(), AUTOSAVE_MS);

  watch(
    values,
    () => {
      // The editor changed something after a failure: try again with it.
      failed.value = null;
      invalid.value = false;
      if (changed.value && autosaves.value) autosaveSoon();
    },
    { deep: true },
  );

  /** On leaving: starts the save. False when autosave cannot save everything, and the editor must be asked. */
  function saveOnLeave(): boolean {
    if (atRisk()) return false;
    void autosave();
    return true;
  }

  // The form closes, by a navigation or with the overlay: what autosave may write goes now,
  // and the tab keeps the changes until it is saved (`kept.forget` after the save).
  onBeforeUnmount(() => {
    mounted = false;
    unsaved.flush();
    if (!changed.value || !autosaves.value) return;
    kept.holdForSave();
    void autosave();
  });

  /** A save with a button: the first save of a new document, a held field, or "Keep mine". */
  async function save(options: { keepMine?: boolean } = {}): Promise<void> {
    // Enter in a read-only field still submits the form while a save runs.
    if (source.readOnly() || saving.value) return;
    autosaveSoon.cancel();
    unsaved.flush();
    if (!form.checkAll()) {
      toast.error("Some fields need attention before you can save.");
      await showIssues();
      return;
    }
    await write(values.value, options);
  }

  /** Goes to what stops the save: the fields that break a rule, or the two versions of a conflict. */
  async function fix(): Promise<void> {
    if (conflict.state.value !== "none") {
      (source.root?.() ?? document).querySelector<HTMLElement>("[data-save-conflict]")?.focus();
      return;
    }
    form.checkAll();
    await showIssues();
  }

  /** "Try again" after a failed autosave. */
  function retry(): Promise<void> {
    failed.value = null;
    invalid.value = false;
    return autosave();
  }

  return {
    values,
    revision,
    version,
    loading,
    loadError,
    saving,
    busy,
    isNew,
    issues: form.issues,
    dirty,
    /** Whether leaving would lose changes. */
    atRisk,
    failed,
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
    autosave,
    retry,
    fix,
  };
}
