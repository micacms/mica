/**
 * The downloads of the projects, copied into the built site.
 *
 * A media field that is not an image reaches Astro as a path from the content
 * root, and Astro does not copy such files by itself. This endpoint reads each
 * one with `mediaFile` and writes it to `/files/<path>`.
 */

import { readFile } from "node:fs/promises";

import { mediaFile } from "@micacms/astro";
import type { APIRoute, GetStaticPaths } from "astro";
import { getCollection } from "astro:content";

import { site } from "../../mica";

export const getStaticPaths = (async () => {
  const projects = await getCollection("projects");
  return [...new Set(projects.flatMap((project) => project.data.downloads))].map((path) => ({ params: { path } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) => new Response(await readFile(mediaFile(site, params.path!)));
