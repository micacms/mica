# 21. Rules of the field kinds

**Status:** Accepted

## Context

Each rule below changes what is stored or what is valid. After 1.0, a change of any of them is a break.

## Decision

- `text({ pattern })` is a full match with the `u` flag: `new RegExp("^(?:" + pattern + ")$", "u")`. An invalid pattern fails when the model loads.
- `media({ alt })` is an opt-in. With `alt`, the value is `{ path, alt }` and the editor asks for alt text beside the preview. Without it, the value is a path.
- `tags()` is a free list of short words, never `null`. A tag given twice, in any case, is refused. A fixed list is `select({ multiple })`, a list of entries is a relation.
- `coordinates({ map })` shows a map, with MapLibre. The presets `"liberty"`, `"bright"` and `"positron"` are OpenFreeMap styles; `{ style, hosts }` names another style. Each address must use `https`. With a map, the value is `{ lat, lng, zoom }`; without it, `{ lat, lng }`.
- The editor's Content-Security-Policy adds the hosts of a map only when the model has one. Mica does not fetch a style to find its hosts.

## Consequences

- A "contains" rule needs `.*x.*`.
- A multilingual site keeps `media()` and puts a localized `alt` object beside it.
- With a map, the tile host sees the editor's IP address and the area of the map. A key in a style address is public, because the model is committed.
