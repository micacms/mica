<script setup lang="ts">
/**
 * Rich text.
 *
 * Tiptap over ProseMirror, constrained to the marks and nodes the field
 * declares. An editor never has to know a markup language, and restricting the
 * schema means they cannot accidentally produce markup the frontend has no
 * styles for.
 *
 * What leaves this component is **Markdoc**, not HTML. Tiptap's own `getHTML()`
 * is never called: the value is converted from ProseMirror JSON on the way out
 * and back on the way in, because the stored form is a `.mdoc` file that has to
 * be readable in a diff and safe to render into a static site.
 */

import { computed, onBeforeUnmount, watch } from "vue";

import Link from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";
import { EditorContent, useEditor } from "@tiptap/vue-3";

import type { RichTextFeature, RichTextField } from "@micacms/core";

import FieldShell from "./FieldShell.vue";
import { useField, type FieldProps } from "@/composables/useField";
import { equivalentMarkdoc, fromMarkdoc, toMarkdoc, type ProseMirrorNode } from "@/lib/markdoc";

const props = defineProps<FieldProps & { modelValue: unknown }>();
const emit = defineEmits<{ "update:modelValue": [string | null] }>();

const field = computed(() => props.field as RichTextField);
const { inputId, label, error, describedBy, hintId, errorId } = useField(props);

const DEFAULT_TOOLBAR: RichTextFeature[] = [
  "bold",
  "italic",
  "heading",
  "bulletList",
  "orderedList",
  "link",
];

const toolbar = computed(() => field.value.toolbar ?? DEFAULT_TOOLBAR);
const enabled = (feature: RichTextFeature) => toolbar.value.includes(feature);

const editor = useEditor({
  content: fromMarkdoc(typeof props.modelValue === "string" ? props.modelValue : ""),
  editable: !(props.disabled || field.value.readonly),

  extensions: [
    StarterKit.configure({
      // Only offer what the field declares, so the output stays predictable.
      heading: enabled("heading") ? { levels: [2, 3] } : false,
      bulletList: enabled("bulletList") ? {} : false,
      orderedList: enabled("orderedList") ? {} : false,
      blockquote: enabled("blockquote") ? {} : false,
      horizontalRule: enabled("horizontalRule") ? {} : false,
      strike: enabled("strike") ? {} : false,
      code: false,
      codeBlock: false,
    }),
    ...(enabled("link")
      ? [
          Link.configure({
            openOnClick: false,
            autolink: true,
            protocols: ["http", "https", "mailto", "tel"],
            // Never emit javascript: or data: URLs from pasted content.
            HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
          }),
        ]
      : []),
  ],

  editorProps: {
    attributes: {
      id: inputId,
      role: "textbox",
      "aria-multiline": "true",
      "aria-label": label.value,
    },
  },

  onUpdate({ editor: instance }) {
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
    if (!instance || instance.isFocused) return;

    const incoming = typeof next === "string" ? next : "";
    const current = instance.isEmpty ? "" : toMarkdoc(instance.getJSON() as ProseMirrorNode);

    if (!equivalentMarkdoc(incoming, current)) {
      // `false` suppresses the update event, so this does not loop back.
      instance.commands.setContent(fromMarkdoc(incoming), false);
    }
  },
);

watch(
  () => props.disabled,
  (isDisabled) => editor.value?.setEditable(!(isDisabled || field.value.readonly)),
);

onBeforeUnmount(() => editor.value?.destroy());

function toggleLink(): void {
  const instance = editor.value;
  if (!instance) return;

  const existing = instance.getAttributes("link").href as string | undefined;
  const href = window.prompt("Link address", existing ?? "https://");

  if (href === null) return;
  if (href === "") {
    instance.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }

  if (!/^(https?:|mailto:|tel:|\/)/i.test(href)) {
    window.alert("Links must start with http://, https://, mailto:, tel: or /");
    return;
  }

  instance.chain().focus().extendMarkRange("link").setLink({ href }).run();
}

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
  ];

  return all.filter((button) => enabled(button.feature));
});
</script>

<template>
  <FieldShell
    :input-id="inputId"
    :label="label"
    :description="field.description"
    :required="field.required"
    :error="error"
    :hint-id="hintId"
    :error-id="errorId"
  >
    <div
      :class="[
        'rich-text overflow-hidden rounded-sm border bg-raised focus-within:ring-2 focus-within:ring-ink/10',
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
          :disabled="disabled || field.readonly"
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

      <EditorContent :editor="editor" :aria-describedby="describedBy" />
    </div>
  </FieldShell>
</template>
