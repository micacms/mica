import { getSchema, mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";

import type { RichTextFeature } from "@micacms/core/internal";

export interface RichTextExtensionOptions {
  /** The address of a preview for an image path as Markdoc stores it, such as `media/house.jpg`. */
  imageUrl?: (src: string) => string | null;
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
  ];
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
