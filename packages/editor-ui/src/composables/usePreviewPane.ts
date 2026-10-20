/**
 * The live preview beside the form: whether it is open, its width, its mode,
 * the page of the document that the form shows, and the overlay form for
 * another document on that page. One module-level state, like the stores: the
 * shell shows the pane and the overlay, and each form names its page.
 */

import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";

import { PROMPT } from "@/composables/useUnsavedChanges";

const OPEN_KEY = "mica:preview-open";
const WIDTH_KEY = "mica:preview-width";
const MODE_KEY = "mica:preview-mode";

function stored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage can be off, as in some private windows.
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Then the choice lasts until the page loads again.
  }
}

/** Edit: a click on a field opens it. Browse: the page acts as the website does. */
export type PreviewMode = "edit" | "browse";

/** A document on the page that the overlay form shows, and the field to go to. */
export interface OverlayTarget {
  kind: "entry" | "singleton";
  /** The collection or the singleton. */
  document: string;
  /** The entry's slug, or the singleton's name. */
  id: string;
  field: string;
  /** New for each request, so that a second click on a field of the same document goes there again. */
  request: number;
}

/** Folded away, the preview leaves only its divider. Open unless the editor folded it. */
const open = ref(stored(OPEN_KEY) !== "false");
/** In pixels. */
const width = ref(Number(stored(WIDTH_KEY)) || 560);
const mode = ref<PreviewMode>(stored(MODE_KEY) === "browse" ? "browse" : "edit");
/** The page of the form's document in the dev server, with its owner: the form that named it. */
const page = ref<{ url: string; owner: symbol } | null>(null);
/** The address in the frame. */
const frame = ref<string | null>(null);
const overlay = ref<OverlayTarget | null>(null);
let overlayDirty: () => boolean = () => false;
let requests = 0;

watch(open, (value) => store(OPEN_KEY, String(value)));
watch(width, (value) => store(WIDTH_KEY, String(Math.round(value))));
watch(mode, (value) => store(MODE_KEY, value));
watch(page, (value) => {
  if (value) frame.value = value.url;
});

/** Whether the overlay may close: it has no unsaved changes, or the editor lets them go. */
const mayLeaveOverlay = (): boolean => !overlay.value || !overlayDirty() || window.confirm(PROMPT);

export function usePreviewPane() {
  return {
    open,
    width,
    mode,
    frame: computed(() => frame.value),
    /** Shown while a form names a page: open, or folded away to its divider. */
    visible: computed(() => page.value !== null && frame.value !== null),
    toggle: () => (open.value = !open.value),
    overlay: computed(() => overlay.value),
    /** Opens a document in the overlay. False when the editor kept the unsaved changes of the one there. */
    openOverlay(target: Omit<OverlayTarget, "request">): boolean {
      const current = overlay.value;
      const same = current?.kind === target.kind && current.document === target.document && current.id === target.id;
      if (!same && !mayLeaveOverlay()) return false;
      overlay.value = { ...target, request: ++requests };
      return true;
    },
    /** Closes the overlay. False when the editor kept its unsaved changes. */
    closeOverlay(): boolean {
      if (!mayLeaveOverlay()) return false;
      overlay.value = null;
      return true;
    },
    /** Closes it without asking: its document is gone, or the editor already said yes. */
    dropOverlay: () => (overlay.value = null),
    /** The overlay's form says here whether it has unsaved changes. */
    guardOverlay: (dirty: () => boolean) => (overlayDirty = dirty),
  };
}

/** Names the page of the form's document while the form is open. */
export function usePreviewPage(url: Ref<string | null>): void {
  const owner = Symbol("preview page");
  watch(url, (value) => (page.value = value ? { url: value, owner } : null), { immediate: true });
  // The next form can name its page before this one closes.
  onBeforeUnmount(() => {
    if (page.value?.owner === owner) page.value = null;
  });
}
