/**
 * Rendering a rich-text field.
 *
 * A `richText()` field is persisted as Markdoc, and this is what turns it into
 * HTML at build time. It runs during `astro build` only; the deployed page is
 * static, and no visitor's browser ever sees Markdoc.
 *
 * Markdoc rather than Markdown-with-HTML for one reason that matters: a Markdoc
 * document can only produce what the configuration allows. An undeclared
 * `{% tag %}` renders as nothing rather than as itself, and raw HTML is inert
 * unless it is explicitly permitted — which it is not here. So the canonical
 * content format cannot carry markup that escapes the site's own styling, and a
 * compromised or careless editor session cannot inject script into a build.
 */

import Markdoc, { type Config, type RenderableTreeNode } from "@markdoc/markdoc";

export interface RichTextOptions {
  /**
   * Extra Markdoc configuration: custom tags, nodes or variables.
   *
   * The place a project adds a callout or a gallery block without giving up the
   * closed set that makes the format safe. A tag must be declared here to
   * render at all.
   */
  config?: Config;
}

/**
 * Markdoc source to an HTML string.
 *
 * Returns an empty string for empty input, so a caller can render the result
 * directly without a null check ahead of it.
 */
export function renderRichText(source: string | null | undefined, options: RichTextOptions = {}): string {
  if (!source || source.trim() === "") return "";

  const tree = transformRichText(source, options);
  return Markdoc.renderers.html(tree);
}

/**
 * The intermediate renderable tree, for a project that wants to render with
 * its own components rather than to an HTML string.
 */
export function transformRichText(
  source: string,
  options: RichTextOptions = {},
): RenderableTreeNode {
  return Markdoc.transform(Markdoc.parse(source), options.config ?? {});
}

/**
 * Problems Markdoc found in a document, for a build that wants to be strict.
 *
 * Not called by `renderRichText`: a malformed heading should not stop a site
 * from deploying, and Markdoc degrades to plain text rather than to nothing.
 * Exposed so a project can decide otherwise.
 */
export function validateRichText(source: string, options: RichTextOptions = {}) {
  return Markdoc.validate(Markdoc.parse(source), options.config ?? {});
}
