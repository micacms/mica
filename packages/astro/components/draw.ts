/**
 * Draws each `<LocationMap>` of a page when it comes near the screen. Runs in
 * the browser. A map that cannot load keeps its link to OpenStreetMap.
 */

import type { MapView } from "../dist/map.js";

export function drawLocationMaps(): void {
  const elements = document.querySelectorAll<HTMLElement>("[data-mica-map]");
  if (elements.length === 0) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        void draw(entry.target as HTMLElement);
      }
    },
    { rootMargin: "200px" },
  );
  for (const element of elements) observer.observe(element);
}

async function draw(element: HTMLElement): Promise<void> {
  const view = JSON.parse(element.dataset["micaMap"] ?? "null") as MapView | null;
  if (!view) return;
  const link = element.querySelector("a");
  try {
    const [maplibre, worker] = await Promise.all([
      import("maplibre-gl"),
      // MapLibre finds its worker beside its own file, which a bundler moves; this gives the built address.
      import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url"),
      import("maplibre-gl/dist/maplibre-gl.css"),
    ]);
    maplibre.setWorkerUrl(worker.default);
    if (link) link.hidden = true;
    const map = new maplibre.Map({
      container: element,
      style: view.style,
      center: [view.lng, view.lat],
      zoom: view.zoom,
      // The page scrolls past the map; zoom needs Ctrl or ⌘, and two fingers move it on a phone.
      cooperativeGestures: true,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: { compact: true },
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibre.NavigationControl({ showCompass: false }));
    new maplibre.Marker().setLngLat([view.lng, view.lat]).addTo(map);

    let loaded = false;
    map.once("load", () => (loaded = true));
    map.on("error", () => {
      if (loaded) return;
      map.remove();
      if (link) link.hidden = false;
    });
  } catch {
    if (link) link.hidden = false;
  }
}
