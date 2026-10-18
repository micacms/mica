/** `mapView` gives what `<LocationMap>` draws: the style, the place, its zoom and a link without JavaScript. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_ZOOM, mapView } from "../src/index.js";

describe("mapView", () => {
  it("takes the zoom that the editor stored, else the given one, else the default", () => {
    assert.equal(mapView({ lat: 47.37, lng: 8.54, zoom: 16 }, { zoom: 10 }).zoom, 16);
    assert.equal(mapView({ lat: 47.37, lng: 8.54 }, { zoom: 10 }).zoom, 10);
    assert.equal(mapView({ lat: 47.37, lng: 8.54 }).zoom, DEFAULT_ZOOM);
  });

  it("resolves a preset, a custom style, and liberty without one", () => {
    assert.equal(mapView({ lat: 0, lng: 0 }).style, "https://tiles.openfreemap.org/styles/liberty");
    assert.equal(mapView({ lat: 0, lng: 0 }, { map: "positron" }).style, "https://tiles.openfreemap.org/styles/positron");
    assert.equal(mapView({ lat: 0, lng: 0 }, { map: { style: "https://maps.example.com/style.json" } }).style, "https://maps.example.com/style.json");
  });

  it("links the place on OpenStreetMap", () => {
    assert.equal(
      mapView({ lat: 47.374626, lng: 8.542361, zoom: 15 }).link,
      "https://www.openstreetmap.org/?mlat=47.374626&mlon=8.542361#map=15/47.374626/8.542361",
    );
  });
});
