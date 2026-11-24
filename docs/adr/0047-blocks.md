# 47. Blocks: one definition for the blocks field and for rich text

**Status:** Accepted. Replaces the blocks item of [35](0035-scope-of-1-0.md), and the decisions of [20](0020-rich-text-is-markdoc.md) for an image and for a tag that the model defines.

## Context

A page that is built from parts needs a list whose items have different shapes. Long text needs parts between its paragraphs, such as a call to action or a gallery. With two definitions, a site would declare the same part twice. A tag that the editor does not know makes a rich-text field read-only.

## Decision

- A block is a named set of fields. The model defines it one time.
- A blocks field stores a list of items. Each item names its block and holds that block's values.
- A rich-text field can permit blocks. In the file, a block is a Markdoc tag on lines of its own. A block inside a line of text is not possible.
- The editor shows a block as a card that Mica draws. The definition describes the card as data: a label, an icon from a fixed set, the field for the title, the fields for the summary and a thumbnail. A definition has no CSS and no HTML.
- The real look of a block is the website's. The editor shows it in the live preview only.
- An image in rich text is a built-in media block with one tag form. It holds a media value ([46](0046-media-values-and-providers.md)). The card shows the image.
- A tag that the model does not define keeps the field read-only, as in [20](0020-rich-text-is-markdoc.md).

## Consequences

- An image in a `.mdoc` file is a tag, not a Markdown image. Other Markdown tools do not show it.
- The website gives a component for each block. Mica gives none.
- A plugin can give block definitions as data ([45](0045-plugins.md)).
- The stored shape of a block item and the tag form freeze at 1.0.
- Change this decision when: sites need a block inside a line of text.
