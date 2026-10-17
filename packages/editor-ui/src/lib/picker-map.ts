/**
 * The map of a coordinates field: MapLibre with one pin. Only a dynamic import
 * loads this module, so MapLibre is a separate chunk that only a form with a
 * map fetches.
 */

import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl, type LngLat } from "maplibre-gl";
import workerScript from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

import type { Coordinates } from "@micacms/core/internal";

export interface PickerMapOptions {
  container: HTMLElement;
  /** The address of the MapLibre style. */
  style: string;
  value: Coordinates | null;
  locked: boolean;
  onPick(value: Coordinates): void;
  /** The map cannot show: the style did not load. */
  onFail(): void;
}

export interface PickerMap {
  show(value: Coordinates | null): void;
  lock(locked: boolean): void;
  remove(): void;
}

const WORLD = { center: [0, 30] as [number, number], zoom: 1 };
const PLACE_ZOOM = 13;

let workerAddress: string | undefined;

/**
 * A `blob:` worker keeps the page's Content-Security-Policy, which follows the
 * model. A worker started from its script's own address would keep the policy
 * that came with the script, and the script is cached for a year.
 */
function worker(): string {
  const script = new URL(workerScript, window.location.href).href;
  workerAddress ??= URL.createObjectURL(new Blob([`import ${JSON.stringify(script)};`], { type: "text/javascript" }));
  return workerAddress;
}

/** Six decimals are about 10 cm: enough for a place, and short in the file. */
const round = (value: number) => Math.round(value * 1e6) / 1e6;
const pointOf = (at: LngLat): Coordinates => {
  const wrapped = at.wrap();
  return { lat: round(wrapped.lat), lng: round(wrapped.lng) };
};
const onEarth = (value: Coordinates | null): value is Coordinates =>
  value !== null && Math.abs(value.lat) <= 90 && Math.abs(value.lng) <= 180;

/** Throws when the browser cannot draw the map, as without WebGL. */
export function createPickerMap(options: PickerMapOptions): PickerMap {
  setWorkerUrl(worker());

  const start = onEarth(options.value) ? { center: [options.value.lng, options.value.lat] as [number, number], zoom: PLACE_ZOOM } : WORLD;
  const map = new MapLibreMap({
    container: options.container,
    style: options.style,
    ...start,
    // A page scrolls past the map; zoom needs Ctrl or ⌘, and two fingers move it on a phone.
    cooperativeGestures: true,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    locale: { "Map.Title": "Map to pick the place" },
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new NavigationControl({ showCompass: false }));

  let styleLoaded = false;
  map.once("style.load", () => (styleLoaded = true));
  // A tile that fails later leaves a gap; only a style that does not load leaves no map.
  map.on("error", () => {
    if (!styleLoaded) options.onFail();
  });

  let locked = options.locked;
  let pinned = false;
  const pin = document.createElement("div");
  pin.className = "size-[18px] cursor-grab rounded-full border-[3px] border-surface bg-primary shadow-sm";
  const marker = new Marker({ element: pin, draggable: !locked });
  marker.on("dragend", () => options.onPick(pointOf(marker.getLngLat())));

  map.on("click", (event) => {
    if (locked) return;
    place(event.lngLat);
    options.onPick(pointOf(event.lngLat));
  });

  function place(at: LngLat | [number, number]): void {
    marker.setLngLat(at);
    if (!pinned) marker.addTo(map);
    pinned = true;
  }

  function show(value: Coordinates | null): void {
    if (!onEarth(value)) {
      marker.remove();
      pinned = false;
      return;
    }
    const at: [number, number] = [value.lng, value.lat];
    place(at);
    if (!map.getBounds().contains(at)) map.jumpTo({ center: at, zoom: Math.max(map.getZoom(), PLACE_ZOOM) });
  }

  show(options.value);

  return {
    show,
    lock(next) {
      locked = next;
      marker.setDraggable(!next);
    },
    remove: () => map.remove(),
  };
}
