/**
 * Sitemap, generated at build time from the same collections the pages use.
 *
 * Hand-rolled rather than pulling in `@astrojs/sitemap`: it is twenty lines,
 * and it keeps the dependency list honest — add packages only when repeated
 * use demonstrates the need).
 */

import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

export const GET: APIRoute = async ({ site }) => {
  const origin = (site ?? new URL("http://localhost:4321")).origin;

  const [pages, projects, news, events, team] = await Promise.all([
    getCollection("pages"),
    getCollection("projects"),
    getCollection("news"),
    getCollection("events"),
    getCollection("team"),
  ]);

  /**
   * `lastmod` is omitted where nothing editorial records it.
   *
   * It used to come from a database column that no longer exists. The Git
   * equivalent is the commit that last touched the entry, which a static build
   * has no cheap way to read. An omitted `lastmod` is explicitly allowed by the
   * sitemap protocol, and a wrong one is worse than none: it would tell every
   * crawler that the whole site changed on each deploy.
   */
  const urls: Array<{ path: string; lastmod: string | null }> = [
    { path: "/", lastmod: null },
    { path: "/projects/", lastmod: null },
    { path: "/news/", lastmod: null },
    { path: "/events/", lastmod: null },
    { path: "/team/", lastmod: null },
    ...pages.map((page) => ({ path: `/${page.id}/`, lastmod: null })),
    ...projects.map((item) => ({ path: `/projects/${item.id}/`, lastmod: null })),
    ...events.map((item) => ({ path: `/events/${item.id}/`, lastmod: null })),
    ...team.map((item) => ({ path: `/team/${item.id}/`, lastmod: null })),
    // News is the one collection with an editorial date, so it is the one
    // place a truthful `lastmod` is available.
    ...news.map((item) => ({ path: `/news/${item.id}/`, lastmod: item.data.publishDate })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    ({ path, lastmod }) =>
      `  <url><loc>${origin}${path}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`,
  )
  .join("\n")}
</urlset>
`;

  return new Response(body, {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
};
