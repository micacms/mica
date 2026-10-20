/** The overlay form's part of the editor's address: `?overlay=navigation`. */

import type { LocationQuery, RouteLocationNormalized } from "vue-router";

/** The address without the overlay form, for one that closed. */
export function withoutOverlay(query: LocationQuery): LocationQuery {
  const { overlay: _, ...rest } = query;
  return rest;
}

/** Only the overlay form opened, closed or changed: the form below stays as it is. */
export function onlyOverlayChanged(to: RouteLocationNormalized, from: RouteLocationNormalized): boolean {
  return (
    to.path === from.path &&
    to.hash === from.hash &&
    JSON.stringify(withoutOverlay(to.query)) === JSON.stringify(withoutOverlay(from.query))
  );
}
