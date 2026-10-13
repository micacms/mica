/**
 * Images for meta tags. Mica's loader gives every `media({ accept: "image" })`
 * field as Astro's `ImageMetadata`, so pages use `<Image>` directly; meta tags
 * need an absolute URL string, which is what this module makes.
 */

import { getImage } from "astro:assets";

/** Beyond this, an og:image is just wasted bytes. */
const MAX_SOCIAL_WIDTH = 1200;

/** Vectors carry no raster dimensions and must not be re-encoded. */
export function isVector(image: ImageMetadata): boolean {
  return image.format === "svg";
}

/** An absolute URL to a locally emitted copy of `image`, for a meta tag. */
export async function toStaticUrl(
  image: ImageMetadata | null | undefined,
  site: URL | undefined,
  options: { maxWidth?: number } = {},
): Promise<string | null> {
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
