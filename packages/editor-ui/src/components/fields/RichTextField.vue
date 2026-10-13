<script setup lang="ts">
/**
 * Rich text.
 *
 * Tiptap over ProseMirror. The schema holds every node the editor can show;
 * the field's toolbar limits only the buttons. Stored Markdoc with anything
 * else, or content that Tiptap refuses, is shown read-only with the reason:
 * the field never opens empty, and never writes back a copy with parts
 * missing. An editor never has to know a markup language.
 *
 * What leaves this component is **Markdoc**, not HTML. Tiptap's own `getHTML()`
 * is never called: the value is converted from ProseMirror JSON on the way out
 * and back on the way in, because the stored form is a `.mdoc` file that has to
 * be readable in a diff and safe to render into a static site.
 */

import { computed, inject, onBeforeUnmount, ref, watch } from "vue";

import { EditorContent, useEditor } from "@tiptap/vue-3";

import { richTextFeatures, type RichTextFeature, type RichTextField } from "@micacms/core";

import FieldShell from "./FieldShell.vue";
import { api, type MediaItem } from "@/api";
import InputDialog from "@/components/InputDialog.vue";
import MediaPicker from "@/components/MediaPicker.vue";
import { useField, type FieldProps } from "@/composables/useField";
import { linkProblem } from "@/lib/links";
import { MEDIA_FOLDER } from "@/lib/media-folder";
import {
  equivalentMarkdoc,
  fromMarkdoc,
  toMarkdoc,
  unsupportedMarkdoc,
  type ProseMirrorNode,
} from "@/lib/markdoc";
import { createRichTextExtensions, inputRules, richTextSchema } from "@/lib/rich-text-extensions";

const props = defineProps<FieldProps & { modelValue: unknown }>();
const emit = defineEmits<{ "update:modelValue": [string | null] }>();

const field = computed(() => props.field as RichTextField);
const { inputId, label, error, describedBy, hintId, errorId, locked } = useField(props);

const toolbar = computed(() => richTextFeatures(field.value.toolbar));
const enabled = (feature: RichTextFeature) => toolbar.value.includes(feature);

const source = computed(() => (typeof props.modelValue === "string" ? props.modelValue : ""));

const unsupported = computed(() => unsupportedMarkdoc(source.value));

/** A document that the schema refuses would load as an empty field. */
const loadFailure = computed(() => {
  if (unsupported.value.length > 0) return null;
  try {
    richTextSchema.nodeFromJSON(fromMarkdoc(source.value));
    return null;
  } catch (cause) {
    return `The editor could not load this text (${(cause as Error).message}).`;
  }
});
const readOnlyReason = computed(() =>
  unsupported.value.length > 0
    ? `This text contains ${list(unsupported.value)}, which the editor cannot show.`
    : loadFailure.value,
);

function list(items: string[]): string {
  return items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

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

/** A path as rich text stores it: from the entry's folder, or from the content root with `/`. */
function imageUrl(src: string): string | null {
  if (src.startsWith("/")) return api.media.url(src.slice(1));
  return entryFolder.value ? api.media.url(`${entryFolder.value}/${src}`) : null;
}

const editor = useEditor({
  content: readOnlyReason.value ? "" : fromMarkdoc(source.value),
  editable: !(locked.value || readOnlyReason.value),
  // The base styles are in style.css; an injected <style> tag would break the CSP.
  injectCSS: false,

  extensions: createRichTextExtensions(toolbar.value, { imageUrl }),
  enableInputRules: inputRules(toolbar.value),
  enablePasteRules: inputRules(toolbar.value),

  editorProps: {
    // A function, so that ProseMirror reads the current hint, error and state at each update.
    attributes: () => textboxAttributes(),
    // An image must be a file in the media library: one pasted from another page would point elsewhere.
    transformPastedHTML: (html) => html.replace(/<img\b[^>]*>/gi, ""),
  },

  onUpdate({ editor: instance }) {
    // Read-only: the stored text stays exactly as it is.
    if (readOnlyReason.value) return;

    // ProseMirror represents "empty" as one empty paragraph; the model wants
    // null, so that an untouched field does not write a file.
    const next = instance.isEmpty ? null : toMarkdoc(instance.getJSON() as ProseMirrorNode);

    // Tiptap also fires transactions that change nothing stored — normalising
    // the parsed document on mount, or re-parsing after a reload. Emitting
    // those would replace the value with a differently-serialized twin and
    // mark a freshly saved form dirty, so only a real change leaves here.
    const current = typeof props.modelValue === "string" ? props.modelValue : null;
    if (equivalentMarkdoc(next, current)) return;

    emit("update:modelValue", next);
  },
});

/**
 * Keep the editor in sync when the value is replaced wholesale — reloading
 * after a conflict, for instance. Guarded so it does not fight the typing.
 *
 * The comparison goes through `toMarkdoc` rather than comparing the incoming
 * string to itself: the editor normalises as it parses, so the value it would
 * emit is the only fair thing to compare against, and anything else makes this
 * fire on every keystroke.
 */
watch(
  () => props.modelValue,
  (next) => {
    const instance = editor.value;
    if (!instance || instance.isFocused || readOnlyReason.value) return;

    const incoming = typeof next === "string" ? next : "";
    const current = instance.isEmpty ? "" : toMarkdoc(instance.getJSON() as ProseMirrorNode);

    if (!equivalentMarkdoc(incoming, current)) {
      // No update event, so this does not loop back.
      instance.commands.setContent(fromMarkdoc(incoming), { emitUpdate: false });
    }
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

onBeforeUnmount(() => editor.value?.destroy());

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
  return [
    { label: "Add a row below", glyph: "+ Row", run: () => instance.chain().focus().addRowAfter().run() },
    { label: "Add a column to the right", glyph: "+ Column", run: () => instance.chain().focus().addColumnAfter().run() },
    { label: "Delete this row", glyph: "− Row", run: () => instance.chain().focus().deleteRow().run() },
    { label: "Delete this column", glyph: "− Column", run: () => instance.chain().focus().deleteColumn().run() },
    { label: "Delete the table", glyph: "Delete table", run: () => instance.chain().focus().deleteTable().run() },
  ];
});

interface ToolbarButton {
  feature: RichTextFeature;
  label: string;
  glyph: string;
  isActive: () => boolean;
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
      isActive: () => instance.isActive("table"),
      run: () => {
        if (!instance.isActive("table")) instance.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run();
      },
    },
    {
      feature: "image",
      label: "Image",
      glyph: "▣",
      isActive: () => instance.isActive("image"),
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
          :title="button.label"
          :aria-label="button.label"
          :aria-pressed="button.isActive()"
          :disabled="locked"
          :class="[
            'h-7 min-w-7 rounded px-1.5 text-xs font-semibold transition',
            button.isActive()
              ? 'bg-ink text-surface'
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
          :title="action.label"
          :aria-label="action.label"
          class="h-7 rounded px-1.5 text-xs font-medium text-muted transition hover:bg-raised hover:text-ink"
          @click="action.run()"
        >
          {{ action.glyph }}
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
