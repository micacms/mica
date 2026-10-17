/**
 * One place on a website's map: what `<LocationMap>` of
 * `@micacms/astro/components` draws. Runs at build time; MapLibre loads only
 * in the browser.
 */

import { resolveMap, type Coordinates, type MapPreset, type MapStyle } from "@micacms/core/internal";

/** The zoom of a place that stores none. */
export const DEFAULT_ZOOM = 14;

export interface MapView {
  /** The address of the MapLibre style. */
  style: string;
  lat: number;
  lng: number;
  zoom: number;
  /** The place on OpenStreetMap, for a page without JavaScript. */
  link: string;
}

/**
 * The view of a `coordinates()` value. The zoom is the one that the editor
 * stored, else `options.zoom`, else 14. The style is the field's `map` option,
 * else OpenFreeMap's "liberty".
 */
export function mapView(place: Coordinates, options: { map?: MapPreset | MapStyle | undefined; zoom?: number | undefined } = {}): MapView {
  const zoom = place.zoom ?? options.zoom ?? DEFAULT_ZOOM;
  const { lat, lng } = place;
  return {
    style: resolveMap(options.map ?? "liberty").style,
    lat,
    lng,
    zoom,
    link: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${Math.round(zoom)}/${lat}/${lng}`,
  };
}
