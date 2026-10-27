import type { APIRoute } from "astro";

import setup from "../../../../SETUP.md?raw";

/** The repository's SETUP.md, at a short URL that a coding agent can read. */
export const GET: APIRoute = () =>
  new Response(setup, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
