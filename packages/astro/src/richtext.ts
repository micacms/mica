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

import { markerKey, splitMarkers, type FieldMarker } from "./preview/markers.js";

/** An image as the loader gives it in `_mica.images`: the path as Markdoc writes it, and Astro's image. */
interface TextImage {
  path: string;
  src: { src: string; width?: number; height?: number; format?: string };
}

/** What `renderRichText` reads from an entry or a singleton: its `_mica.images`. */
export interface RichTextSource {
  _mica?: { images?: readonly TextImage[] } | undefined;
}

/** The sizes that Astro makes of an image in rich text. */
export interface RichTextImageOptions {
  /** The widths of the `srcset`. Wider than the original are left out. Default: 480, 800, 1200 and 1600. */
  widths?: number[];
  /** The `sizes` attribute. Default: the full width up to 50rem. */
  sizes?: string;
  /** Default: `"webp"`. */
  format?: "webp" | "avif" | "png" | "jpeg";
}

/** The part of Astro's `getImage` that this module uses. */
export type GetImage = (options: {
  src: TextImage["src"];
  width: number;
  widths: number[];
  sizes: string;
  format: string;
}) => Promise<{ src: string; srcSet: { attribute: string }; attributes: Record<string, unknown> }>;

export interface RichTextOptions {
  /**
   * Extra Markdoc configuration: custom tags, nodes or variables.
   *
   * The place a project adds a callout or a gallery block without giving up the
   * closed set that makes the format safe. A tag must be declared here to
   * render at all. A project's own `image` node replaces Mica's.
   */
  config?: Config;
  /** `false` writes the original files, with their width and height. Default: optimized through Astro's image service. */
  optimize?: boolean | RichTextImageOptions;
  /** Replaces Astro's `getImage`, for a test. */
  getImage?: GetImage;
}

const DEFAULT_IMAGES: Required<RichTextImageOptions> = {
  widths: [480, 800, 1200, 1600],
  sizes: "(min-width: 50rem) 50rem, 100vw",
  format: "webp",
};

function decoded(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

/** A path from the entry's folder: one that `_mica.images` must know. */
const isRelative = (src: string) => src !== "" && !src.startsWith("/") && !/^[a-z][a-z0-9+.-]*:/i.test(src);

let astroGetImage: Promise<GetImage | null> | undefined;

/** Astro's `getImage`, or null outside an Astro build, such as in a plain test. */
function loadGetImage(): Promise<GetImage | null> {
  astroGetImage ??= import("astro:assets").then(
    (assets) => assets.getImage as unknown as GetImage,
    () => null,
  );
  return astroGetImage;
}

const warned = new Set<string>();

/** The `<img>` attributes for each image of the document that the entry knows, by decoded path. */
async function imageAttributes(
  sources: readonly string[],
  images: readonly TextImage[],
  options: RichTextOptions,
): Promise<Map<string, Record<string, unknown>>> {
  const byPath = new Map(images.map((image) => [decoded(image.path), image.src]));
  const sizing = options.optimize === false ? null : { ...DEFAULT_IMAGES, ...(options.optimize === true ? {} : options.optimize) };
  const getImage = sizing ? (options.getImage ?? (await loadGetImage())) : null;
  const found = new Map<string, Record<string, unknown>>();

  for (const src of new Set(sources.map(decoded))) {
    const image = byPath.get(src);
    if (!image) {
      if (isRelative(src) && !warned.has(src)) {
        warned.add(src);
        console.warn(`[mica] An image in rich text has no file: "${src}". Pass the entry's data to renderRichText, so that it finds the entry's images.`);
      }
      continue;
    }
    const original = { src: image.src, ...(image.width ? { width: image.width } : {}), ...(image.height ? { height: image.height } : {}) };
    if (!getImage || !sizing || !image.width) {
      found.set(src, original);
      continue;
    }
    const widths = sizing.widths.filter((width) => width <= image.width!);
    const width = widths.at(-1) ?? image.width;
    const result = await getImage({ src: image, width, widths: widths.length ? widths : [image.width], sizes: sizing.sizes, format: sizing.format });
    found.set(src, {
      src: result.src,
      srcset: result.srcSet.attribute,
      sizes: sizing.sizes,
      ...(result.attributes["width"] ? { width: result.attributes["width"] } : {}),
      ...(result.attributes["height"] ? { height: result.attributes["height"] } : {}),
    });
  }
  return found;
}

/** The `src` of every image in a document. */
function imageSources(document: ReturnType<typeof Markdoc.parse>): string[] {
  const sources: string[] = [];
  for (const node of document.walk()) {
    if (node.type === "image" && typeof node.attributes["src"] === "string") sources.push(node.attributes["src"]);
  }
  return sources;
}

/** The configuration with an image node that writes what `imageAttributes` found; a project's own image node wins. */
function withImages(config: Config, found: Map<string, Record<string, unknown>>): Config {
  if (found.size === 0) return config;
  return {
    ...config,
    nodes: {
      image: {
        attributes: { src: { type: String }, alt: { type: String }, title: { type: String } },
        transform(node, nodeConfig) {
          const attributes = node.transformAttributes(nodeConfig) as Record<string, unknown>;
          // Markdoc gives `src` percent-encoded (`z%C3%BCrich.jpg`); the path is as written. Both are compared decoded.
          const image = found.get(decoded(String(attributes["src"] ?? "")));
          if (!image) return new Markdoc.Tag("img", attributes);
          return new Markdoc.Tag("img", { ...attributes, ...image, loading: "lazy", decoding: "async" });
        },
      },
      ...config.nodes,
    },
  };
}

/**
 * Markdoc source to an HTML string.
 *
 * `from` is the entry's or the singleton's data: its `_mica.images` give each
 * image in the text its file, which Astro optimizes. Returns an empty string
 * for empty input, so a caller can render the result directly without a null
 * check ahead of it.
 */
export async function renderRichText(
  source: string | null | undefined,
  from?: RichTextSource | null,
  options: RichTextOptions = {},
): Promise<string> {
  if (!source || source.trim() === "") return "";
  return Markdoc.renderers.html(await transformRichText(source, from, options));
}

/**
 * The intermediate renderable tree, for a project that wants to render with
 * its own components rather than to an HTML string.
 */
export async function transformRichText(
  source: string,
  from?: RichTextSource | null,
  options: RichTextOptions = {},
): Promise<RenderableTreeNode> {
  // In the live preview the loader appends a marker; it never reaches Markdoc.
  const { text, markers } = splitMarkers(source);
  const document = Markdoc.parse(text);
  const found = await imageAttributes(imageSources(document), from?._mica?.images ?? [], options);
  const tree = Markdoc.transform(document, withImages(options.config ?? {}, found));
  return markers[0] ? markBlocks(tree, markers[0]) : tree;
}

/**
 * Marks each top-level block for the live preview: its field, and its place,
 * which is also its place in the editor's text. A click on a paragraph then
 * puts the cursor in that paragraph.
 */
function markBlocks(tree: RenderableTreeNode, marker: FieldMarker): RenderableTreeNode {
  if (!Markdoc.Tag.isTag(tree)) return tree;
  const key = markerKey(marker);
  let block = 0;
  for (const child of tree.children) {
    if (!Markdoc.Tag.isTag(child)) continue;
    child.attributes["data-mica-field"] = key;
    child.attributes["data-mica-block"] = String(block++);
  }
  return tree;
}

/**
 * Problems Markdoc found in a document, for a build that wants to be strict.
 *
 * Not called by `renderRichText`: a malformed heading should not stop a site
 * from deploying, and Markdoc degrades to plain text rather than to nothing.
 * Exposed so a project can decide otherwise.
 */
export function validateRichText(source: string, options: RichTextOptions = {}) {
  return Markdoc.validate(Markdoc.parse(splitMarkers(source).text), options.config ?? {});
}
