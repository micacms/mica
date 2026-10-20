/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * The preview script, in each page of the preview's dev server. It finds the
 * fields of the page and marks their elements (`data-mica-field`): from the
 * markers in texts and alt texts, from rich text that `renderRichText` marked,
 * and from the fields that templates read (`data-mica-fields`). In the editor's
 * frame, a click on a marked element opens its field in the editor. The editor
 * names the fields with unpublished changes, which get another outline, and
 * gives each field the label that shows on hover. While a field is hovered or
 * has the focus in the form, a white veil fades in over the rest of the page.
 * Frames are drawn in a layer of their own, square with rounded corners and a
 * little space, whatever the shape of the element: a round navigation item too.
 *
 * An element can show fields of several documents, such as a map with the
 * place of an event and the word "Map" from the labels. Its primary field
 * belongs to the form's document; the others become buttons in its label.
 *
 * Messages, both ways with `postMessage`:
 * - editor → page: `hello` with the colours and the corner radii; `state` with the mode, the changed markers (a rich text
 *   with its changed blocks, `blocks`), the labels,
 *   the field paths of each model and the form's document; `focus` with the marker of the form's
 *   focused field, or null; and `reload`;
 * - page → editor: `fields` with the page's path and its markers, `select` with one, and
 *   `select-secondary` with a marker whose label offers a second action, such as editing a related entry.
 * A block of rich text, an image of a gallery or another item of a list has its number (`data-mica-block`): `select` and
 * `focus` carry it, so that a click on a paragraph puts the cursor there, and back.
 * The page takes messages only from its parent, and `hello` only from an
 * editor that the integration allows (`startPreview`). It answers only that origin.
 */

import { decodeMarkers, FIELDS_ATTRIBUTE as FIELDS, markerKey as keyOf, markerOfKey, modelPath, type FieldMarker } from "./markers.js";

const FROM_EDITOR = "mica-editor";
const FROM_PAGE = "mica-preview";
const ATTRIBUTE = "data-mica-field";
/** The other fields that an element shows, as a JSON list of `data-mica-field` values: buttons in its label. */
const ALSO = "data-mica-also";
const CHANGED = "data-mica-changed";
/** On the elements of the field that has the focus in the form. */
const FOCUSED = "data-mica-focused";
/** The place of a block of rich text, of an image in a gallery, or of another item of a list. */
const BLOCK = "data-mica-block";
/** On an element that the page could not give to a document with the current models: it is not tried again until they change. */
const UNRESOLVED = "data-mica-unresolved";
/** On the root element in Browse mode: the page then acts as the website does. */
const BROWSE = "data-mica-browse";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function isMarker(value: unknown): value is FieldMarker {
  return isRecord(value) && typeof value["document"] === "string" && typeof value["id"] === "string" && typeof value["path"] === "string";
}

/** What the editor tells about the models: the field paths of each collection or singleton, and the form's document. */
interface Models {
  fields: Map<string, Set<string>>;
  main: { document: string; id: string } | null;
}

/**
 * The nearest document around an element whose model has `path`, or a start of
 * it: in the smallest part of the page that shows one, the form's document
 * first; else the form's document anyway.
 */
function nearestDocument(element: Element, path: string, models: Models): FieldMarker | null {
  const main = models.main;
  const fieldOf = (document: string) => modelPath(path, models.fields.get(document));
  for (let area: Element | null = element; area && area !== document.documentElement; area = area.parentElement) {
    const found = [...area.querySelectorAll(`[${ATTRIBUTE}]`)]
      .map((marked) => markerOfKey(marked.getAttribute(ATTRIBUTE)))
      .flatMap((marker) => {
        const field = marker ? fieldOf(marker.document) : null;
        return marker && field ? [{ document: marker.document, id: marker.id, path: field }] : [];
      });
    const own = found.find((marker) => !!main && marker.document === main.document && marker.id === main.id);
    if (own ?? found[0]) return own ?? found[0]!;
  }
  const field = main ? fieldOf(main.document) : null;
  return main && field ? { ...main, path: field } : null;
}

/**
 * A path that ends with a place in a list whose items have no fields, such as
 * `gallery.2` or `team.1`: the field, and the place as its block, as for an image
 * of a gallery or a chosen entry. A row of a repeater keeps its path.
 */
function itemOf(marker: FieldMarker, fields: ReadonlySet<string> | undefined): FieldMarker {
  const match = /^(.+)\.(\d+)$/.exec(marker.path);
  if (!match) return marker;
  const list = match[1]!.split(".").filter((part) => !/^\d+$/.test(part)).join(".");
  if ([...(fields ?? [])].some((field) => field.startsWith(`${list}.`))) return marker;
  return { ...marker, path: match[1]!, block: Number(match[2]) };
}

const alsoOf = (element: Element): string[] => {
  try {
    const keys: unknown = JSON.parse(element.getAttribute(ALSO) ?? "[]");
    return Array.isArray(keys) ? keys.filter((key) => typeof key === "string") : [];
  } catch {
    return [];
  }
};

/**
 * Gives each element that its template marks with the fields that it reads to
 * the documents of those fields: a date, a number or an option, which have no
 * text that can carry a marker. The primary field is one of the form's
 * document; the others are kept for the label. A container with marked
 * elements inside is left to them, and the page's `<head>` shows nothing.
 */
function resolveFields(models: Models): void {
  if (models.fields.size === 0) return;
  for (const element of document.body.querySelectorAll(`[${FIELDS}]:not([${ATTRIBUTE}]):not([${UNRESOLVED}])`)) {
    if (element.querySelector(`[${ATTRIBUTE}], [${FIELDS}]`)) continue;
    const paths = (element.getAttribute(FIELDS) ?? "").split(" ").filter(Boolean);
    const found = [
      ...new Map(
        paths
          .map((path) => nearestDocument(element, path, models))
          .filter((marker) => marker !== null)
          .map((marker) => itemOf(marker, models.fields.get(marker.document)))
          .map((marker) => [keyOf(marker), marker]),
      ).values(),
    ];
    const own = (marker: FieldMarker) => !!models.main && marker.document === models.main.document && marker.id === models.main.id;
    const [primary, ...others] = [...found.filter(own), ...found.filter((marker) => !own(marker))];
    if (!primary) {
      element.setAttribute(UNRESOLVED, "");
      continue;
    }
    element.setAttribute(ATTRIBUTE, keyOf(primary));
    if (primary.block !== undefined) element.setAttribute(BLOCK, String(primary.block));
    if (others.length > 0) element.setAttribute(ALSO, JSON.stringify(others.map(keyOf)));
  }
}

/** Marks the parent element of each text with a marker, and each image whose alt text has one. Returns every marker in the page, also the other fields of elements. */
function scan(models: Models): FieldMarker[] {
  const markers = new Map<string, FieldMarker>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement;
    const [first] = decodeMarkers(node.nodeValue ?? "");
    // One element, one field: the first marker in it.
    if (element && first && !element.hasAttribute(ATTRIBUTE)) element.setAttribute(ATTRIBUTE, keyOf(first));
  }
  // An image of a media field carries its marker in the alt text, with its place in a gallery.
  for (const image of document.querySelectorAll("img[alt]")) {
    const [marker] = decodeMarkers(image.getAttribute("alt") ?? "");
    if (!marker || image.hasAttribute(ATTRIBUTE)) continue;
    image.setAttribute(ATTRIBUTE, keyOf(marker));
    if (marker.block !== undefined) image.setAttribute(BLOCK, String(marker.block));
  }
  resolveFields(models);
  // Rich text comes marked: `renderRichText` writes the attribute on the text.
  for (const element of document.querySelectorAll(`[${ATTRIBUTE}]`)) {
    for (const key of [element.getAttribute(ATTRIBUTE) ?? "", ...alsoOf(element)]) {
      const marker = markerOfKey(key);
      if (marker) markers.set(keyOf(marker), marker);
    }
  }
  return [...markers.values()];
}

/** The editor's colours and corner radii, from its tokens. */
interface Look {
  edit: string;
  onEdit: string;
  changed: string;
  onChanged: string;
  /** The corners of a frame: the brand's radius for panels. */
  frame: string;
  /** The corners of a button in the label: the brand's radius for chips. */
  chip: string;
}

/** The space between an element and its frame, in pixels. */
const PADDING = 6;

const styles = (look: Look) => `
  html:not([${BROWSE}]) [${ATTRIBUTE}] { cursor: pointer; }
  #mica-preview-spot, #mica-preview-changes > div { position: fixed; pointer-events: none; box-sizing: border-box; border-radius: ${look.frame}; }
  #mica-preview-spot {
    z-index: 2147483646; opacity: 0; border: 2px solid ${look.edit};
    box-shadow: 0 0 0 200vmax color-mix(in srgb, white 70%, transparent);
    transition: opacity 180ms ease-out, top 120ms ease-out, left 120ms ease-out, width 120ms ease-out, height 120ms ease-out;
  }
  #mica-preview-spot[data-shown] { opacity: 1; }
  #mica-preview-spot[data-changed] { border-color: ${look.changed}; }
  #mica-preview-changes > div { z-index: 2147483645; border: 2px dashed ${look.changed}; }
  html[${BROWSE}] #mica-preview-changes { display: none; }
  @media (prefers-reduced-motion: reduce) { #mica-preview-spot { transition: none; } }
  #mica-preview-label {
    position: fixed; z-index: 2147483647; display: none; flex-wrap: wrap; align-items: center; gap: 4px;
    max-width: 420px; font: 600 12px/1.4 system-ui, sans-serif; letter-spacing: normal; text-transform: none;
  }
  #mica-preview-label > button {
    padding: 3px 9px; border-radius: ${look.chip}; border: 0; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    font: inherit; cursor: pointer; background: color-mix(in srgb, ${look.edit} 72%, black); color: ${look.onEdit};
  }
  #mica-preview-label > button:first-child { background: ${look.edit}; }
  #mica-preview-label[data-changed] > button:first-child { background: ${look.changed}; color: ${look.onChanged}; }
  #mica-preview-label > button:hover { filter: brightness(0.88); }
`;

/** Without a list, the editor on this computer: the local editor, or a self-hosted one in development. */
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

function allowed(origin: string, editors: readonly string[]): boolean {
  if (editors.length > 0) return editors.includes(origin);
  try {
    return LOCAL_HOSTS.includes(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/** Only a colour or a radius, never more CSS: they go into a style element of the page. */
const isColour = (value: unknown): value is string => typeof value === "string" && CSS.supports("color", value);
const isRadius = (value: unknown): value is string => typeof value === "string" && CSS.supports("border-radius", value);

const smooth = (): ScrollBehavior => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

function start(editors: readonly string[]): void {
  let editor: string | null = null;
  let browsing = false;
  /** The changed fields; for a rich text, the places of its changed blocks, when the editor knows them. */
  let changed = new Map<string, number[]>();
  /**
   * The hover label of each field. `opens` says what a click does: go to a field
   * of the form, open another form, or open the overlay form (shown with ↗).
   * `secondary` names a second action, such as the related entry that a click on its button edits.
   */
  let labels = new Map<string, { text: string; opens?: string; secondary?: string }>();
  let sent = "";
  let models: Models = { fields: new Map(), main: null };

  const post = (message: Record<string, unknown>) => editor && window.parent.postMessage({ source: FROM_PAGE, ...message }, editor);

  const changes = document.createElement("div");
  changes.id = "mica-preview-changes";

  /** The frame of an element, with space around it. */
  const frameOf = (element: Element) => {
    const box = element.getBoundingClientRect();
    return { top: `${box.top - PADDING}px`, left: `${box.left - PADDING}px`, width: `${box.width + 2 * PADDING}px`, height: `${box.height + 2 * PADDING}px` };
  };

  /** Whether an element takes up space on the page: a hidden one gets no frame. */
  const shown = (element: Element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && (element.checkVisibility?.() ?? true);
  };

  /** A dashed frame around each shown element with unpublished changes; in a rich text, around each changed block. */
  const placeChanges = () => {
    const elements = [...document.querySelectorAll(`[${CHANGED}]`)]
      .flatMap((element) => {
        const blocks = (changed.get(element.getAttribute(ATTRIBUTE) ?? "") ?? []).flatMap((block) => [
          ...element.querySelectorAll(`:scope > [${BLOCK}="${block}"]`),
        ]);
        return blocks.length > 0 ? blocks : [element];
      })
      .filter(shown);
    while (changes.children.length > elements.length) changes.lastElementChild?.remove();
    while (changes.children.length < elements.length) changes.append(document.createElement("div"));
    elements.forEach((element, index) => Object.assign((changes.children[index] as HTMLElement).style, frameOf(element)));
  };

  const paint = () => {
    for (const element of document.querySelectorAll(`[${ATTRIBUTE}]`)) {
      element.toggleAttribute(CHANGED, changed.has(element.getAttribute(ATTRIBUTE) ?? ""));
    }
    placeChanges();
  };

  /** Tells the editor the markers of the page, when they changed. */
  const report = () => {
    const markers = scan(models);
    paint();
    const keys = markers.map(keyOf).sort().join("\n");
    if (keys === sent) return;
    sent = keys;
    post({ type: "fields", path: location.pathname, markers });
  };

  const style = document.createElement("style");
  const spot = document.createElement("div");
  spot.id = "mica-preview-spot";
  const label = document.createElement("div");
  label.id = "mica-preview-label";
  let hovered: Element | null = null;
  /** The element of the field that has the focus in the form. */
  let focusedElement: Element | null = null;

  /** The frame of the hovered element, or else of the focused one, with a white veil over the rest of the page. It fades in and out. */
  const placeSpot = () => {
    const candidate = browsing ? null : (hovered ?? focusedElement);
    const target = candidate && candidate.isConnected && shown(candidate) ? candidate : null;
    if (!target) {
      spot.removeAttribute("data-shown");
      return;
    }
    spot.toggleAttribute("data-changed", target.hasAttribute(CHANGED));
    const place = frameOf(target);
    if (spot.hasAttribute("data-shown")) {
      Object.assign(spot.style, place);
      return;
    }
    // Hidden, it moves to the new place at once, and then fades in there.
    spot.style.transition = "none";
    Object.assign(spot.style, place);
    void spot.offsetWidth;
    spot.style.transition = "";
    spot.setAttribute("data-shown", "");
  };

  /** The text of an action: ↗ when it opens another document in the overlay form. */
  const actionText = (text: string, opens: string | undefined) => (opens === "overlay" ? `${text} ↗` : text);

  /** A button of the label: an action of the hovered element. `title` only where it says more than the text. */
  const actionButton = (text: string, title: string | null, message: Record<string, unknown>) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    if (title) button.title = title;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      post(message);
    });
    return button;
  };

  /** The label above the frame of the hovered element, else below it, else inside it: its field, and its other actions, all buttons. */
  const placeLabel = () => {
    placeSpot();
    placeChanges();
    const key = hovered?.getAttribute(ATTRIBUTE) ?? null;
    const marker = markerOfKey(key);
    const entry = key ? labels.get(key) : undefined;
    if (!hovered || !marker || !entry || browsing) {
      label.style.display = "none";
      return;
    }
    // The field itself: the same as a click on the element.
    const own = actionButton(actionText(entry.text, entry.opens), null, { type: "select", marker });
    const buttons = [
      // The related entry: always in the overlay form.
      ...(entry.secondary ? [actionButton(actionText(entry.secondary, "overlay"), `Edit “${entry.secondary}”`, { type: "select-secondary", marker })] : []),
      ...alsoOf(hovered).flatMap((also) => {
        const other = markerOfKey(also);
        const action = labels.get(also);
        return other && action ? [actionButton(actionText(action.text, action.opens), `Open “${action.text}”`, { type: "select", marker: other })] : [];
      }),
    ];
    label.replaceChildren(own, ...buttons);
    label.toggleAttribute("data-changed", hovered.hasAttribute(CHANGED));
    label.style.display = "flex";
    const box = hovered.getBoundingClientRect();
    const above = box.top - PADDING - label.offsetHeight - 4;
    const below = box.bottom + PADDING + 4;
    label.style.top = `${above >= 0 ? above : below + label.offsetHeight <= window.innerHeight ? below : box.top + 4}px`;
    label.style.left = `${Math.max(0, Math.min(box.left - PADDING, window.innerWidth - label.offsetWidth))}px`;
  };

  const setHovered = (next: Element | null) => {
    hovered = next;
    placeLabel();
  };

  // The label stays a moment after the pointer leaves the field, so that its buttons can be reached.
  let leaving: ReturnType<typeof setTimeout> | undefined;
  const hover = (next: Element | null) => {
    clearTimeout(leaving);
    if (next === hovered) return;
    if (next === null && hovered && label.querySelector("button")) leaving = setTimeout(() => setHovered(null), 400);
    else setHovered(next);
  };
  document.addEventListener("mouseover", (event) => {
    if (event.target instanceof Node && label.contains(event.target)) {
      clearTimeout(leaving);
      return;
    }
    hover(event.target instanceof Element ? event.target.closest(`[${ATTRIBUTE}]`) : null);
  });
  document.documentElement.addEventListener("mouseleave", () => hover(null));
  window.addEventListener("scroll", placeLabel, { passive: true, capture: true });
  window.addEventListener("resize", placeLabel);
  // A late image, a font or an opened section moves the fields: the frames follow.
  let framing = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(framing);
    framing = requestAnimationFrame(placeLabel);
  }).observe(document.body);

  /**
   * Outlines the elements of a field, and scrolls to it when it is not in view.
   * A group, such as `seo`, finds the fields in it; an empty path, all fields
   * of a related entry. With a block: that image of a gallery, or that
   * paragraph of a rich text, whose whole text keeps the outline.
   */
  const focus = (marker: FieldMarker | null, block: number | null) => {
    for (const element of document.querySelectorAll(`[${FOCUSED}]`)) element.removeAttribute(FOCUSED);
    focusedElement = null;
    if (!marker) {
      placeSpot();
      return;
    }
    let found = [...document.querySelectorAll(`[${ATTRIBUTE}]`)].filter((element) => {
      const other = markerOfKey(element.getAttribute(ATTRIBUTE));
      const inField = marker.path === "" || other?.path === marker.path || !!other?.path.startsWith(`${marker.path}.`);
      return !!other && other.document === marker.document && other.id === marker.id && inField;
    });
    let target: Element | undefined = found[0];
    if (block !== null) {
      const exact = found.find((element) => element.getAttribute(BLOCK) === String(block));
      const inside = found[0]?.querySelector(`[${BLOCK}="${block}"]`) ?? undefined;
      found = exact ? [exact] : found.slice(0, 1);
      target = exact ?? inside ?? found[0];
    }
    for (const element of found) element.setAttribute(FOCUSED, "");
    focusedElement = found[0] ?? null;
    placeSpot();
    if (!target) return;
    const box = target.getBoundingClientRect();
    if (box.top >= 0 && box.bottom <= window.innerHeight) return;
    target.scrollIntoView({ behavior: smooth(), block: "center" });
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || !isRecord(event.data) || event.data["source"] !== FROM_EDITOR) return;
    const data = event.data;
    if (data["type"] === "hello" && isRecord(data["colours"])) {
      if (!allowed(event.origin, editors)) return;
      editor = event.origin;
      const colours = data["colours"];
      const radii = isRecord(data["radii"]) ? data["radii"] : {};
      if (["edit", "onEdit", "changed", "onChanged"].every((name) => isColour(colours[name])) && isRadius(radii["frame"]) && isRadius(radii["chip"])) {
        style.textContent = styles({ ...(colours as unknown as Look), frame: radii["frame"], chip: radii["chip"] });
      }
      document.head.append(style);
      document.body.append(changes, spot, label);
      sent = "";
      report();
    }
    // Everything else only from the editor that said hello.
    if (event.origin !== editor) return;
    if (data["type"] === "state") {
      if (isRecord(data["models"])) {
        const main = data["main"];
        models = {
          fields: new Map(
            Object.entries(data["models"]).map(([document, paths]) => [document, new Set(Array.isArray(paths) ? paths.filter((path) => typeof path === "string") : [])]),
          ),
          main: isRecord(main) && typeof main["document"] === "string" && typeof main["id"] === "string" ? { document: main["document"], id: main["id"] } : null,
        };
        // With the models known, the elements that templates mark find their documents, also those that did not find one before.
        for (const element of document.querySelectorAll(`[${UNRESOLVED}]`)) element.removeAttribute(UNRESOLVED);
        report();
      }
      browsing = data["mode"] === "browse";
      document.documentElement.toggleAttribute(BROWSE, browsing);
      if (Array.isArray(data["changed"])) {
        changed = new Map(
          data["changed"].filter(isMarker).map((marker) => {
            const blocks: unknown = (marker as unknown as Record<string, unknown>)["blocks"];
            return [keyOf(marker), Array.isArray(blocks) ? blocks.filter((block) => Number.isInteger(block)) : []] as const;
          }),
        );
      }
      if (Array.isArray(data["labels"])) {
        labels = new Map(
          data["labels"].flatMap((item: unknown) =>
            isRecord(item) && isMarker(item["marker"]) && typeof item["label"] === "string"
              ? [
                  [
                    keyOf(item["marker"]),
                    {
                      text: item["label"],
                      ...(typeof item["opens"] === "string" ? { opens: item["opens"] } : {}),
                      ...(typeof item["secondary"] === "string" ? { secondary: item["secondary"] } : {}),
                    },
                  ] as const,
                ]
              : [],
          ),
        );
      }
      paint();
      placeLabel();
    }
    if (data["type"] === "focus") focus(isMarker(data["marker"]) ? data["marker"] : null, typeof data["block"] === "number" ? data["block"] : null);
    if (data["type"] === "reload") location.reload();
  });

  // In Edit mode, a click on a field opens it. Alt-click follows a link, as in Browse mode.
  document.addEventListener(
    "click",
    (event) => {
      if (!editor || browsing || event.altKey || !(event.target instanceof Element)) return;
      const element = event.target.closest(`[${ATTRIBUTE}]`);
      const marker = markerOfKey(element?.getAttribute(ATTRIBUTE) ?? null);
      if (!element || !marker) return;
      event.preventDefault();
      event.stopPropagation();
      // The image of a gallery has its place; a paragraph of a rich text has it inside the text.
      const block = element.getAttribute(BLOCK) ?? event.target.closest(`[${BLOCK}]`)?.getAttribute(BLOCK) ?? null;
      post({ type: "select", marker, ...(block === null ? {} : { block: Number(block) }) });
    },
    true,
  );

  // Islands and scripts can add text after the load.
  let timer: ReturnType<typeof setTimeout> | undefined;
  new MutationObserver((records) => {
    // The label, the spot and the frames are the script's own elements: changing them is no change of the page.
    if (records.every((record) => [label, spot, changes].some((own) => record.target === own || own.contains(record.target)))) return;
    clearTimeout(timer);
    timer = setTimeout(report, 150);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

/** Starts the preview script in the editor's frame. Opened on its own, the page stays as it is. */
export function startPreview(editors: readonly string[] = []): void {
  if (window.parent !== window) start(editors);
}
