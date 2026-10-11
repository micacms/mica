/**
 * Where the browser goes after sign-in: a page of this editor, or the start page.
 *
 * Parsed the way a browser parses a `Location`, so that `/\evil.example`, a
 * tab or a line break cannot turn a path into another host (#87).
 */
export function safeReturnTo(raw: string | undefined, publicUrl: string): string {
  const fallback = "/admin/";
  if (!raw || !raw.startsWith("/")) return fallback;

  let url: URL;
  try {
    url = new URL(raw, publicUrl);
  } catch {
    return fallback;
  }

  if (url.origin !== new URL(publicUrl).origin) return fallback;
  if (url.pathname !== "/admin" && !url.pathname.startsWith("/admin/")) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
