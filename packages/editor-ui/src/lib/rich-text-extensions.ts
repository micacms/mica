import Link from "@tiptap/extension-link";
import StarterKit from "@tiptap/starter-kit";

/**
 * The Tiptap extensions of every rich-text field. The schema always holds every
 * node that Markdoc can store and the editor can show: the field's `toolbar`
 * limits only the buttons. A schema without headings would refuse a stored
 * heading, and Tiptap would open the field empty.
 */
export function createRichTextExtensions() {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      protocols: ["http", "https", "mailto", "tel"],
      // Never emit javascript: or data: URLs from pasted content.
      HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
    }),
  ];
}
