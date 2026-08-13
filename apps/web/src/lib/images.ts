/**
 * Turning content media into build-time static assets.
 *
 * Media is now a file in the repository, referenced by a path relative to the
 * content root — `projects/haus-a/media/exterior.jpg`. That is a much better
 * starting point than the CMS URL it replaces: the file is on disk when the
 * build runs, so Astro's image service can treat it as a local asset. Nothing
 * is fetched, nothing has to be reachable, and the "is the CMS up?" question
 * disappears from the build.
 *
 * Vite cannot resolve a path it only learns at runtime, so every image under
 * the content root is collected here at build time and looked up by path. The
 * glob is eager but cheap: it produces metadata, not pixels.
 */

import { getImage } from "astro:assets";

/** Beyond this, an og:image is just wasted bytes. */
const MAX_SOCIAL_WIDTH = 1200;

const modules = import.meta.glob<{ default: ImageMetadata }>(
  "../../../../content/**/*.{jpeg,jpg,png,webp,avif,gif,tiff,svg}",
  { eager: true },
);

/**
 * Keyed by content-root-relative path, which is the form the loader emits.
 *
 * The glob keys are relative to this file, so the marker is cut off rather
 * than a fixed number of `../` segments assumed — moving this file should not
 * silently empty the map.
 */
const MARKER = "/content/";

const byPath = new Map<string, ImageMetadata>(
  Object.entries(modules).flatMap(([key, module]) => {
    const at = key.indexOf(MARKER);
    return at === -1 ? [] : [[key.slice(at + MARKER.length), module.default] as const];
  }),
);

/**
 * The build-time metadata for one media reference.
 *
 * Null when the model references a file the repository does not contain. That
 * is a content problem, not a build problem: a missing image should leave a gap
 * on the page, not stop the site from deploying.
 */
export function resolveMedia(path: string | null | undefined): ImageMetadata | null {
  if (!path) return null;
  return byPath.get(path) ?? null;
}

/** Vectors carry no raster dimensions and must not be re-encoded. */
export function isVector(image: ImageMetadata): boolean {
  return image.format === "svg";
}

/**
 * An absolute URL to a locally-emitted copy of `path`.
 *
 * `<CmsImage>` covers images inside the page; meta tags need a plain absolute
 * URL string, which is what this produces. Unlike the CMS version of this
 * helper, there is no case left where the URL points somewhere else: the file
 * is emitted into the build output either way.
 */
export async function toStaticUrl(
  path: string | null | undefined,
  site: URL | undefined,
  options: { maxWidth?: number } = {},
): Promise<string | null> {
  const image = resolveMedia(path);
  if (!image) return null;

  const origin = site ?? new URL("http://localhost:4321");
  if (isVector(image)) return new URL(image.src, origin).href;

  const width = Math.min(image.width, options.maxWidth ?? MAX_SOCIAL_WIDTH);
  const optimised = await getImage({
    src: image,
    width,
    height: Math.round((image.height * width) / image.width),
    format: "webp",
  });

  return new URL(optimised.src, origin).href;
}
