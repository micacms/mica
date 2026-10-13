import { getSchema } from "@tiptap/core";
import Link from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";

import type { RichTextFeature } from "@micacms/core";

/**
 * The Tiptap extensions of a rich-text field. The schema always holds every
 * node that Markdoc can store and the editor can show, so that stored text
 * always loads: a schema without headings would refuse a stored heading, and
 * Tiptap would open the field empty. The toolbar limits what an editor can
 * add: the buttons, and the shortcuts as they type or paste (`inputRules`).
 */
export function createRichTextExtensions(toolbar: readonly RichTextFeature[] = []) {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }),
    Link.configure({
      openOnClick: false,
      autolink: toolbar.includes("link"),
      protocols: ["http", "https", "mailto", "tel"],
      // Never emit javascript: or data: URLs from pasted content.
      HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
    }),
  ];
}

/** Extension names whose typing and paste shortcuts a toolbar allows. Code has no button and always has them. */
export function inputRules(toolbar: readonly RichTextFeature[]): string[] {
  return ["code", "codeBlock", ...toolbar];
}

/** The schema of every rich-text field, for a check before the editor loads a document. */
export const richTextSchema = getSchema(createRichTextExtensions());
