<script setup lang="ts">
/**
 * Rich text.
 *
 * Tiptap over ProseMirror. The schema holds every node the editor can show;
 * the field's toolbar limits only the buttons. Stored Markdoc with anything
 * else, or content that Tiptap refuses, is shown read-only with the reason:
 * the field never opens empty, and never writes back a copy with parts
 * missing. That is decided as the field loads; an edit that would make the
 * text unkeepable, such as an image dropped into a list, is refused instead.
 * An editor never has to know a markup language.
 *
 * What leaves this component is **Markdoc**, not HTML. Tiptap's own `getHTML()`
 * is never called: the value is converted from ProseMirror JSON on the way out
 * and back on the way in, because the stored form is a `.mdoc` file that has to
 * be readable in a diff and safe to render into a static site. The conversion
 * runs when the typing pauses, on blur, and before the form saves or leaves.
 */

import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import { Selection } from "@tiptap/pm/state";

import { EditorContent, useEditor } from "@tiptap/vue-3";

import { isWebAddress, richTextFeatures, type RichTextFeature, type RichTextField } from "@micacms/core/internal";

import FieldShell from "./FieldShell.vue";
import { api, type MediaItem } from "@/api";
import InputDialog from "@/components/InputDialog.vue";
import MediaPicker from "@/components/MediaPicker.vue";
import { useField, type FieldProps } from "@/composables/useField";
import { debounce } from "@/lib/debounce";
import { FIELD_BLOCK, FOCUS_BLOCK } from "@/lib/focus";
import { linkProblem } from "@/lib/links";
import { equivalentMarkdoc, toMarkdoc, type ProseMirrorNode } from "@/lib/markdoc";
import { MEDIA_FOLDER } from "@/lib/media-folder";
import { PENDING_EDITS } from "@/lib/pending-edits";
import { createRichTextExtensions, inputRules, loadRichText } from "@/lib/rich-text-extensions";
import { useToast } from "@/stores/toast";

const props = defineProps<FieldProps & { modelValue: unknown }>();
const emit = defineEmits<{ "update:modelValue": [string | null] }>();

const field = computed(() => props.field as RichTextField);
const { inputId, label, error, describedBy, hintId, errorId, locked } = useField(props);

const toolbar = computed(() => richTextFeatures(field.value.toolbar));
const enabled = (feature: RichTextFeature) => toolbar.value.includes(feature);

const source = computed(() => (typeof props.modelValue === "string" ? props.modelValue : ""));

const loaded = loadRichText(source.value);
/** Decided at load, and again only when the form replaces the value: never by an edit. */
const readOnlyReason = ref(loaded.readOnly);
/** The Markdoc that the editor shows: as loaded, or as last converted. */
let shown = source.value;

const toast = useToast();

function textboxAttributes(): Record<string, string> {
  const attributes: Record<string, string> = {
    id: inputId,
    role: "textbox",
    "aria-multiline": "true",
    "aria-labelledby": `${inputId}-label`,
  };
  if (describedBy.value) attributes["aria-describedby"] = describedBy.value;
  if (error.value) attributes["aria-invalid"] = "true";
  if (locked.value) attributes["aria-readonly"] = "true";
  return attributes;
}

/** The folder of the entry, such as `news/hello`, where its `media/` folder is. Null for a new entry without a URL. */
const mediaFolder = inject(MEDIA_FOLDER, undefined);
const pickerFolder = computed(() => mediaFolder?.value ?? null);
const entryFolder = computed(() => pickerFolder.value?.path.replace(/\/media$/, "") ?? null);

/** The preview address of a path as rich text stores it: from the entry's folder, or from the content root with `/`. */
function imageUrl(src: string): string | null {
  if (isWebAddress(src)) return null;
  let path: string;
  try {
    // Markdown keeps a space or a letter outside ASCII percent-encoded; `api.media.url` encodes it once.
    path = decodeURI(src);
  } catch {
    path = src;
  }
  if (path.startsWith("/")) return api.media.url(path.slice(1));
  return entryFolder.value ? api.media.url(`${entryFolder.value}/${path}`) : null;
}

/** Why the image button is off, or null when it works. */
const imageBlocked = computed(() => {
  if (!pickerFolder.value || pickerFolder.value.isNew) return "Save the entry once, then add images.";
  return null;
});

const editor = useEditor({
  content: loaded.doc ?? "",
  editable: !(locked.value || readOnlyReason.value),
  // The base styles are in style.css; an injected <style> tag would break the CSP.
  injectCSS: false,

  extensions: createRichTextExtensions(toolbar.value, { imageUrl, onRefuse: (reason) => toast.info(reason) }),
  enableInputRules: inputRules(toolbar.value),
  enablePasteRules: inputRules(toolbar.value),

  editorProps: {
    // A function, so that ProseMirror reads the current hint, error and state at each update.
    attributes: () => textboxAttributes(),
    // An image must be a file in the media library: one pasted from another page would point elsewhere.
    // An image cut or copied in this editor carries its stored path and stays.
    transformPastedHTML: (html) => html.replace(/<img\b(?![^>]*\bdata-mica-src=)[^>]*>/gi, ""),
  },

  // A keystroke only asks for the conversion. The first one after a pause gets it at once, so the form is dirty at once.
  onUpdate: () => convertSoon(),
  onBlur: () => {
    convertSoon.flush();
    shownBlock = -1;
  },
  onFocus: () => reportBlock(),
  onSelectionUpdate: () => reportBlock(),
  onCreate: ({ editor: instance }) => instance.view.dom.addEventListener(FOCUS_BLOCK, focusBlock),
});

/** The top-level block of the cursor, as last reported: the live preview scrolls to it. */
let shownBlock = -1;

/** Tells the form, and so the live preview, which block the cursor is in. */
function reportBlock(): void {
  const instance = editor.value;
  if (!instance?.isFocused) return;
  const block = instance.state.selection.$from.index(0);
  if (block === shownBlock) return;
  shownBlock = block;
  instance.view.dom.dispatchEvent(new CustomEvent(FIELD_BLOCK, { bubbles: true, detail: block }));
}

/** A click on a paragraph in the live preview: the cursor goes to the start of that block, and it comes into view. */
function focusBlock(event: Event): void {
  const instance = editor.value;
  const index: unknown = (event as CustomEvent).detail;
  if (!instance || typeof index !== "number" || index < 0 || index >= instance.state.doc.childCount) return;
  event.preventDefault();
  let position = 0;
  for (let child = 0; child < index; child++) position += instance.state.doc.child(child).nodeSize;
  const { state, view } = instance;
  view.dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(position + 1))));
  view.focus();
  const node = view.nodeDOM(position);
  if (node instanceof HTMLElement) {
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" });
  }
}

/** Converts the document to Markdoc and gives it to the form. */
function convert(): void {
  const instance = editor.value;
  // Read-only: the stored text stays exactly as it is.
  if (!instance || readOnlyReason.value) return;

  // ProseMirror represents "empty" as one empty paragraph; the model wants
  // null, so that an untouched field does not write a file.
  const next = instance.isEmpty ? null : toMarkdoc(instance.getJSON() as ProseMirrorNode);
  shown = next ?? "";

  // Tiptap also fires transactions that change nothing stored — normalising
  // the parsed document on mount, or re-parsing after a reload. Emitting
  // those would replace the value with a differently-serialized twin and
  // mark a freshly saved form dirty, so only a real change leaves here.
  const current = typeof props.modelValue === "string" ? props.modelValue : null;
  if (equivalentMarkdoc(next, current)) return;

  emit("update:modelValue", next);
}

const convertSoon = debounce(convert, 300, { leading: true });
// The form flushes it before a save, before it leaves the page, and before it keeps the changes in this tab.
const removeFlush = inject(PENDING_EDITS, undefined)?.add(convertSoon.flush);

/**
 * Keep the editor in sync when the form replaces the value — reloading after
 * a conflict, or restoring kept changes. The field's own value comes back
 * equal to `shown` and changes nothing. Guarded so it does not fight the typing.
 */
watch(
  () => props.modelValue,
  (next) => {
    const incoming = typeof next === "string" ? next : "";
    const instance = editor.value;
    if (equivalentMarkdoc(incoming, shown) || !instance || instance.isFocused) return;

    // The form's value wins over a conversion that waits.
    convertSoon.cancel();
    const load = loadRichText(incoming);
    shown = incoming;
    readOnlyReason.value = load.readOnly;
    // No update event, so this does not loop back.
    if (load.doc) instance.commands.setContent(load.doc, { emitUpdate: false });
  },
);

watch([locked, readOnlyReason], ([isLocked, reason]) => editor.value?.setEditable(!(isLocked || reason)));

// A new hint or error arrives without an edit; ProseMirror reads the attributes only at an update.
watch([describedBy, error, locked], () => {
  const dom = editor.value?.view.dom;
  if (!dom) return;
  for (const name of ["aria-describedby", "aria-invalid", "aria-readonly"]) dom.removeAttribute(name);
  for (const [name, value] of Object.entries(textboxAttributes())) dom.setAttribute(name, value);
});

// A removed row takes its waiting edit along. Before any other unmount, a blur or the form has flushed it.
onBeforeUnmount(() => {
  removeFlush?.();
  convertSoon.cancel();
  editor.value?.destroy();
});

const linkDialog = ref({ open: false, href: "", error: null as string | null, existing: false });

function toggleLink(): void {
  const existing = editor.value?.getAttributes("link").href as string | undefined;
  linkDialog.value = { open: true, href: existing ?? "https://", error: null, existing: !!existing };
}

function applyLink(): void {
  const instance = editor.value;
  const href = linkDialog.value.href.trim();
  if (!instance) return;
  if (href === "") {
    removeLink();
    return;
  }
  const problem = linkProblem(href);
  if (problem) {
    linkDialog.value.error = problem;
    return;
  }
  linkDialog.value.open = false;
  instance.chain().focus().extendMarkRange("link").setLink({ href }).run();
}

function removeLink(): void {
  linkDialog.value.open = false;
  editor.value?.chain().focus().extendMarkRange("link").unsetLink().run();
}

/* Images: the picker gives a file, then the dialog asks for its alt text. */

const pickerOpen = ref(false);
const imageDialog = ref({ open: false, src: "", alt: "", error: null as string | null, editing: false });

function chooseImage(): void {
  const instance = editor.value;
  if (instance?.isActive("image")) {
    const { src, alt } = instance.getAttributes("image") as { src?: string; alt?: string };
    imageDialog.value = { open: true, src: src ?? "", alt: alt ?? "", error: null, editing: true };
    return;
  }
  pickerOpen.value = true;
}

function onImageChosen(items: MediaItem[]): void {
  const item = items[0];
  if (!item) return;
  // The entry's own files are stored from its folder, so the path stays right when its URL changes.
  const folder = entryFolder.value;
  const src = folder && item.path.startsWith(`${folder}/`) ? item.path.slice(folder.length + 1) : `/${item.path}`;
  imageDialog.value = { open: true, src, alt: "", error: null, editing: false };
}

function applyImage(): void {
  const { src, editing } = imageDialog.value;
  const alt = imageDialog.value.alt.trim();
  if (alt === "") {
    imageDialog.value.error = "Describe what the image shows, for people who cannot see it.";
    return;
  }
  // Markdown ends the alt text at a bracket.
  if (/[[\]]/.test(alt)) {
    imageDialog.value.error = "Use round brackets ( ) instead of square brackets [ ].";
    return;
  }
  imageDialog.value.open = false;
  const chain = editor.value?.chain().focus();
  if (editing) chain?.updateAttributes("image", { alt }).run();
  else chain?.setImage({ src, alt }).run();
}

/* Tables: a button inserts one; inside a table, a second row of buttons changes its rows and columns. */

const inTable = computed(() => editor.value?.isActive("table") ?? false);

const tableActions = computed(() => {
  const instance = editor.value;
  if (!instance) return [];
  // The visible words are the accessible names; the title says where a row or column goes.
  return [
    { label: "Add row", title: "Add a row below this one", run: () => instance.chain().focus().addRowAfter().run() },
    { label: "Add column", title: "Add a column to the right", run: () => instance.chain().focus().addColumnAfter().run() },
    { label: "Delete row", title: "Delete this row", run: () => instance.chain().focus().deleteRow().run() },
    { label: "Delete column", title: "Delete this column", run: () => instance.chain().focus().deleteColumn().run() },
    { label: "Delete table", title: "Delete the whole table", run: () => instance.chain().focus().deleteTable().run() },
  ];
});

interface ToolbarButton {
  feature: RichTextFeature;
  label: string;
  glyph: string;
  isActive: () => boolean;
  /** Why the button is off here, or null. */
  blocked?: () => string | null;
  run: () => void;
}

const buttons = computed<ToolbarButton[]>(() => {
  const instance = editor.value;
  if (!instance) return [];

  const all: ToolbarButton[] = [
    {
      feature: "bold",
      label: "Bold",
      glyph: "B",
      isActive: () => instance.isActive("bold"),
      run: () => instance.chain().focus().toggleBold().run(),
    },
    {
      feature: "italic",
      label: "Italic",
      glyph: "I",
      isActive: () => instance.isActive("italic"),
      run: () => instance.chain().focus().toggleItalic().run(),
    },
    {
      feature: "strike",
      label: "Strikethrough",
      glyph: "S",
      isActive: () => instance.isActive("strike"),
      run: () => instance.chain().focus().toggleStrike().run(),
    },
    {
      feature: "heading",
      label: "Heading",
      glyph: "H2",
      isActive: () => instance.isActive("heading", { level: 2 }),
      run: () => instance.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      feature: "heading",
      label: "Subheading",
      glyph: "H3",
      isActive: () => instance.isActive("heading", { level: 3 }),
      run: () => instance.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      feature: "bulletList",
      label: "Bulleted list",
      glyph: "•",
      isActive: () => instance.isActive("bulletList"),
      run: () => instance.chain().focus().toggleBulletList().run(),
    },
    {
      feature: "orderedList",
      label: "Numbered list",
      glyph: "1.",
      isActive: () => instance.isActive("orderedList"),
      run: () => instance.chain().focus().toggleOrderedList().run(),
    },
    {
      feature: "blockquote",
      label: "Quote",
      glyph: "❝",
      isActive: () => instance.isActive("blockquote"),
      run: () => instance.chain().focus().toggleBlockquote().run(),
    },
    {
      feature: "link",
      label: "Link",
      glyph: "🔗",
      isActive: () => instance.isActive("link"),
      run: toggleLink,
    },
    {
      feature: "horizontalRule",
      label: "Divider",
      glyph: "—",
      isActive: () => false,
      run: () => instance.chain().focus().setHorizontalRule().run(),
    },
    {
      feature: "table",
      label: "Table",
      glyph: "▦",
      isActive: () => false,
      // A table cannot hold a table, and a list item cannot hold one in Markdown.
      blocked: () => (instance.isActive("table") || instance.isActive("listItem") ? "Place the cursor outside a table or a list." : null),
      run: () => instance.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run(),
    },
    {
      feature: "image",
      label: "Image",
      glyph: "▣",
      isActive: () => false,
      blocked: () =>
        instance.isActive("image")
          ? null
          : (imageBlocked.value ?? (instance.isActive("table") || instance.isActive("listItem") ? "Place the cursor outside a table or a list." : null)),
      run: chooseImage,
    },
  ];

  return all.filter((button) => enabled(button.feature));
});
</script>

<template>
  <FieldShell
    as="text"
    :input-id="inputId"
    :label="label"
    :description="field.description"
    :required="field.required"
    :error="error"
    :hint-id="hintId"
    :error-id="errorId"
  >
    <div v-if="readOnlyReason" class="rounded-sm border border-line bg-canvas/60">
      <p class="border-b border-line px-3 py-2 text-sm" role="status">
        {{ readOnlyReason }} To keep it, it is read-only here. A developer can change it in the
        <code>.mdoc</code> file.
      </p>
      <pre
        :id="inputId"
        class="max-h-96 overflow-auto px-3 py-2 text-xs whitespace-pre-wrap"
        tabindex="0"
        :aria-labelledby="`${inputId}-label`"
        :aria-describedby="describedBy"
      >{{ source }}</pre>
    </div>

    <div
      v-else
      :class="[
        'rich-text overflow-hidden rounded-sm border bg-surface focus-within:ring-2 focus-within:ring-ink/10',
        error ? 'border-danger' : 'border-line focus-within:border-ink',
      ]"
    >
      <div
        class="flex flex-wrap items-center gap-0.5 border-b border-line bg-canvas/60 px-1.5 py-1"
        role="toolbar"
        :aria-label="`${label} formatting`"
      >
        <button
          v-for="button in buttons"
          :key="button.label"
          type="button"
          :title="button.blocked?.() ?? button.label"
          :aria-label="button.blocked?.() ? `${button.label}: ${button.blocked()}` : button.label"
          :aria-pressed="button.feature === 'table' || button.feature === 'image' ? undefined : button.isActive()"
          :disabled="locked || !!button.blocked?.()"
          :class="[
            'h-7 min-w-7 rounded px-1.5 text-xs font-semibold transition',
            button.isActive()
              ? 'bg-primary text-on-primary'
              : 'text-muted hover:bg-raised hover:text-ink',
          ]"
          @click="button.run()"
        >
          {{ button.glyph }}
        </button>
      </div>

      <div
        v-if="inTable && !locked"
        class="flex flex-wrap items-center gap-0.5 border-b border-line bg-canvas/60 px-1.5 py-1"
        role="toolbar"
        :aria-label="`${label} table`"
      >
        <button
          v-for="action in tableActions"
          :key="action.label"
          type="button"
          :title="action.title"
          class="h-7 rounded px-1.5 text-xs font-medium text-muted transition hover:bg-raised hover:text-ink"
          @click="action.run()"
        >
          {{ action.label }}
        </button>
      </div>

      <EditorContent :editor="editor" />
    </div>

    <MediaPicker
      :open="pickerOpen"
      accept="image"
      :folder="pickerFolder"
      @close="pickerOpen = false"
      @choose="onImageChosen"
    />

    <InputDialog
      v-model="imageDialog.alt"
      :open="imageDialog.open"
      :title="imageDialog.editing ? 'Alt text' : 'Add the image'"
      label="Alt text"
      hint="Say what the image shows, in one sentence. Screen readers read it, and search engines use it."
      :error="imageDialog.error"
      :confirm-label="imageDialog.editing ? 'Apply' : 'Add the image'"
      @confirm="applyImage"
      @cancel="imageDialog.open = false"
    />

    <InputDialog
      v-model="linkDialog.href"
      :open="linkDialog.open"
      title="Link"
      label="Link address"
      type="url"
      hint="A web address, an email (mailto:), a phone number (tel:), or a page of this website (/about)."
      :error="linkDialog.error"
      @confirm="applyLink"
      @cancel="linkDialog.open = false"
    >
      <template v-if="linkDialog.existing" #extra>
        <button type="button" class="btn-ghost mr-auto" @click="removeLink">Remove link</button>
      </template>
    </InputDialog>
  </FieldShell>
</template>
