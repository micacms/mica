import { Extension, getSchema, mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import type { Node as DocumentNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";

import type { RichTextFeature } from "@micacms/core/internal";

import { readMarkdoc, type ProseMirrorNode } from "@/lib/markdoc";

export interface RichTextExtensionOptions {
  /** The address of a preview for an image path as Markdoc stores it, such as `media/house.jpg`. */
  imageUrl?: (src: string) => string | null;
  /** Called with the reason when the editor refuses an edit that Markdoc could not keep. */
  onRefuse?: (reason: string) => void;
}

/**
 * The Tiptap extensions of a rich-text field. The schema always holds every
 * node that Markdoc can store and the editor can show, so that stored text
 * always loads: a schema without headings would refuse a stored heading, and
 * Tiptap would open the field empty. The toolbar limits what an editor can
 * add: the buttons, and the shortcuts as they type or paste (`inputRules`).
 */
export function createRichTextExtensions(toolbar: readonly RichTextFeature[] = [], options: RichTextExtensionOptions = {}) {
  return [
    // Markdoc has no underline, and the link below has its own settings.
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] }, link: false, underline: false }),
    Link.configure({
      openOnClick: false,
      autolink: toolbar.includes("link"),
      protocols: ["http", "https", "mailto", "tel"],
      // Never emit javascript: or data: URLs from pasted content.
      HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
    }),
    Table.configure({ resizable: false }),
    TableRow,
    // A cell of a pipe table holds one line of text.
    TableHeader.extend({ content: "paragraph" }),
    TableCell.extend({ content: "paragraph" }),
    Image.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          // On a paste, the stored path comes back from `data-mica-src`, not from the preview address.
          src: { default: null, parseHTML: (element) => element.getAttribute("data-mica-src") ?? element.getAttribute("src") },
        };
      },
      // The stored path is relative to the entry; the preview needs an address that the browser can load.
      renderHTML({ HTMLAttributes }) {
        const src = String(HTMLAttributes["src"] ?? "");
        return ["img", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, { src: options.imageUrl?.(src) ?? src, "data-mica-src": src })];
      },
    }).configure({ inline: false, allowBase64: false }),
    keepable(options.onRefuse),
  ];
}

/**
 * Why Markdoc could not keep a document that the schema allows, or null.
 * Stored text like this opens read-only, so the editor refuses the edit that would make it.
 */
export function unkeepableReason(doc: DocumentNode): string | null {
  const visit = (node: DocumentNode, inList: boolean): string | null => {
    if (node.type.name === "image" && inList) return "An image cannot go in a list. Put it above or below the list.";
    // Markdoc reads a tag in a code block too, and a backslash there stays visible.
    if (node.type.name === "codeBlock" && /\{%[\s\S]*?%\}/.test(node.textContent)) {
      return "A code block cannot hold {% … %}. The website would read it as an instruction.";
    }
    if (node.isTextblock || node.isLeaf) return null;
    const nested = inList || node.type.name === "listItem";
    for (let index = 0; index < node.childCount; index++) {
      const reason = visit(node.child(index), nested);
      if (reason) return reason;
    }
    return null;
  };
  return visit(doc, false);
}

/** Refuses an edit, such as an image dropped into a list, that would make the document unkeepable. */
function keepable(onRefuse?: (reason: string) => void) {
  return Extension.create({
    name: "keepable",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey("keepable"),
          filterTransaction(transaction, state) {
            if (!transaction.docChanged) return true;
            const reason = unkeepableReason(transaction.doc);
            // A document that was unkeepable before came from outside: the field shows it read-only.
            if (!reason || unkeepableReason(state.doc)) return true;
            onRefuse?.(reason);
            return false;
          },
        }),
      ];
    },
  });
}

/**
 * Extension names whose typing and paste shortcuts a toolbar allows. Code has no button and always has them.
 * An image comes only from the button, which asks for a file of the media library and its alt text.
 */
export function inputRules(toolbar: readonly RichTextFeature[]): string[] {
  return ["code", "codeBlock", ...toolbar.filter((feature) => feature !== "image")];
}

/** The schema of every rich-text field, for a check before the editor loads a document. */
export const richTextSchema = getSchema(createRichTextExtensions());

/** What a rich-text field loads: the document, or why it opens read-only. */
export type RichTextLoad = { doc: ProseMirrorNode; readOnly: null } | { doc: null; readOnly: string };

/**
 * Decides once, as the field loads, whether the editor can keep the stored text.
 * An edit never changes the answer: the editor refuses an edit that would make it unkeepable.
 */
export function loadRichText(source: string | null | undefined): RichTextLoad {
  const { unsupported, doc } = readMarkdoc(source);
  if (unsupported.length > 0) return { doc: null, readOnly: `This text contains ${list(unsupported)}, which the editor cannot show.` };
  try {
    // A document that the schema refuses would load as an empty field.
    richTextSchema.nodeFromJSON(doc);
  } catch (cause) {
    return { doc: null, readOnly: `The editor could not load this text (${(cause as Error).message}).` };
  }
  return { doc, readOnly: null };
}

function list(items: string[]): string {
  return items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
