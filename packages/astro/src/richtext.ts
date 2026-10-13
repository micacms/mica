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
  /**
   * The images of the entry, `entry.data._mica.images`. An image in the text
   * gets the address, width and height that Astro made for it. Without them,
   * the path stays as written, which a browser cannot load.
   */
  images?: ReadonlyArray<{ path: string; src: { src: string; width?: number; height?: number } }>;
}

/** The configuration with an image node that uses the entry's images; a project's own image node wins. */
function withImages(options: RichTextOptions): Config {
  const config = options.config ?? {};
  if (!options.images?.length) return config;
  const byPath = new Map(options.images.map((image) => [image.path, image.src]));
  return {
    ...config,
    nodes: {
      image: {
        attributes: { src: { type: String }, alt: { type: String }, title: { type: String } },
        transform(node, nodeConfig) {
          const attributes = node.transformAttributes(nodeConfig) as Record<string, unknown>;
          const image = byPath.get(String(attributes["src"] ?? ""));
          if (!image) return new Markdoc.Tag("img", attributes);
          const { width, height } = image;
          return new Markdoc.Tag("img", {
            ...attributes,
            src: image.src,
            ...(width ? { width } : {}),
            ...(height ? { height } : {}),
            loading: "lazy",
            decoding: "async",
          });
        },
      },
      ...config.nodes,
    },
  };
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
  return Markdoc.transform(Markdoc.parse(source), withImages(options));
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
