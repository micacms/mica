import Link from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";

import type { RichTextFeature } from "@micacms/core";

/** Creates the Tiptap extensions for one rich-text toolbar. */
export function createRichTextExtensions(toolbar: readonly RichTextFeature[]) {
  const enabled = (feature: RichTextFeature): boolean => toolbar.includes(feature);

  return [
    StarterKit.configure({
      heading: enabled("heading") ? { levels: [2, 3] } : false,
      bulletList: enabled("bulletList") ? {} : false,
      orderedList: enabled("orderedList") ? {} : false,
      blockquote: enabled("blockquote") ? {} : false,
      horizontalRule: enabled("horizontalRule") ? {} : false,
      strike: enabled("strike") ? {} : false,
      // Code has no toolbar action, but it is valid stored Markdoc. Keep the
      // nodes in the schema so opening a code block does not discard it.
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
  ];
}
