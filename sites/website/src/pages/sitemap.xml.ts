import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

export const GET: APIRoute = async ({ site }) => {
  const docs = await getCollection("docs");
  const comparisons = await getCollection("comparisons");
  const paths = ["/", "/docs/", "/compare/", "/changelog/", "/imprint/", ...docs.map((item) => `/docs/${item.id}/`), ...comparisons.map((item) => `/compare/${item.id}/`)];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${new URL(path, site)}</loc></url>`).join("")}</urlset>`;
  return new Response(body, { headers: { "Content-Type": "application/xml" } });
};
