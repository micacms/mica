/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * The preview script, in each page of the preview's dev server. It finds the
 * field markers in the page's text and marks their elements. In the editor's
 * frame, a click on a marked element opens its field in the editor. The editor
 * names the fields with unpublished changes, which get another outline, and
 * gives each field the label that shows on hover. When a field of the form
 * gets the focus, the page scrolls to its text and outlines it.
 *
 * Messages, both ways with `postMessage`:
 * - editor → page: `hello` with the colours, then `state` with the mode, the changed markers and the labels,
 *   `focus` with the marker of the form's focused field, or null, and `reload`;
 * - page → editor: `fields` with the page's path and its markers, `select` with one.
 * A block of rich text has its number (`data-mica-block`): `select` and `focus` carry it, so
 * that a click on a paragraph puts the cursor there, and the cursor's paragraph comes into view.
 * The page takes messages only from its parent, and `hello` only from an
 * editor that the integration allows (`startPreview`). It answers only that origin.
 */

import { decodeMarkers, markerKey as keyOf, markerOfKey, type FieldMarker } from "./markers.js";

const FROM_EDITOR = "mica-editor";
const FROM_PAGE = "mica-preview";
const ATTRIBUTE = "data-mica-field";
const CHANGED = "data-mica-changed";
/** On the elements of the field that has the focus in the form. */
const FOCUSED = "data-mica-focused";
/** On all elements of the hovered field: the blocks of a rich text light up together. */
const HOVERED = "data-mica-hover";
/** The place of a block of rich text, which `renderRichText` writes. */
const BLOCK = "data-mica-block";
/** On the root element in Browse mode: the page then acts as the website does. */
const BROWSE = "data-mica-browse";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function isMarker(value: unknown): value is FieldMarker {
  return isRecord(value) && typeof value["document"] === "string" && typeof value["id"] === "string" && typeof value["path"] === "string";
}

/** Marks the parent element of each text with a marker, and each image whose alt text has one. Returns every marker in the page, also those of rich text. */
function scan(): FieldMarker[] {
  const markers = new Map<string, FieldMarker>();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement;
    const [first, ...rest] = decodeMarkers(node.nodeValue ?? "");
    if (!element || !first) continue;
    // One element, one field: the first marker in it.
    if (!element.hasAttribute(ATTRIBUTE)) element.setAttribute(ATTRIBUTE, keyOf(first));
    for (const marker of [first, ...rest]) markers.set(keyOf(marker), { document: marker.document, id: marker.id, path: marker.path });
  }
  // An image of a media field carries its marker in the alt text, with its place in a gallery.
  for (const image of document.querySelectorAll("img[alt]")) {
    const [marker] = decodeMarkers(image.getAttribute("alt") ?? "");
    if (!marker || image.hasAttribute(ATTRIBUTE)) continue;
    image.setAttribute(ATTRIBUTE, keyOf(marker));
    if (marker.block !== undefined) image.setAttribute(BLOCK, String(marker.block));
  }
  // Rich text comes marked: `renderRichText` writes the attribute on each block.
  for (const element of document.querySelectorAll(`[${ATTRIBUTE}]`)) {
    const marker = markerOfKey(element.getAttribute(ATTRIBUTE));
    if (marker) markers.set(keyOf(marker), marker);
  }
  return [...markers.values()];
}

interface Colours {
  edit: string;
  onEdit: string;
  changed: string;
  onChanged: string;
}

const styles = (colours: Colours) => `
  html:not([${BROWSE}]) [${ATTRIBUTE}] { cursor: pointer; }
  html:not([${BROWSE}]) [${HOVERED}] { outline: 2px solid ${colours.edit} !important; outline-offset: 2px; }
  html:not([${BROWSE}]) [${CHANGED}] { outline: 2px dashed ${colours.changed} !important; outline-offset: 2px; }
  html:not([${BROWSE}]) [${CHANGED}][${HOVERED}] { outline-style: solid !important; }
  html:not([${BROWSE}]) [${FOCUSED}] { outline: 2px solid ${colours.edit} !important; outline-offset: 2px; }
  #mica-preview-label {
    position: fixed; z-index: 2147483647; pointer-events: none; display: none;
    padding: 2px 6px; border-radius: 4px; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font: 600 12px/1.4 system-ui, sans-serif; letter-spacing: normal; text-transform: none;
    background: ${colours.edit}; color: ${colours.onEdit};
  }
  #mica-preview-label[data-changed] { background: ${colours.changed}; color: ${colours.onChanged}; }
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

/** Only a colour, never more CSS: the colours go into a style element of the page. */
const isColour = (value: unknown): value is string => typeof value === "string" && CSS.supports("color", value);

function start(editors: readonly string[]): void {
  let editor: string | null = null;
  let browsing = false;
  let changed = new Set<string>();
  let labels = new Map<string, string>();
  let sent = "";

  const post = (message: Record<string, unknown>) => editor && window.parent.postMessage({ source: FROM_PAGE, ...message }, editor);

  /** The elements of one field: the blocks of a rich text, or the one element of a text. */
  const fieldElements = (key: string) => [...document.querySelectorAll(`[${ATTRIBUTE}]`)].filter((element) => element.getAttribute(ATTRIBUTE) === key);

  const paint = () => {
    for (const element of document.querySelectorAll(`[${ATTRIBUTE}]`)) {
      element.toggleAttribute(CHANGED, changed.has(element.getAttribute(ATTRIBUTE) ?? ""));
    }
  };

  /** Tells the editor the markers of the page, when they changed. */
  const report = () => {
    const markers = scan();
    paint();
    const keys = markers.map(keyOf).sort().join("\n");
    if (keys === sent) return;
    sent = keys;
    post({ type: "fields", path: location.pathname, markers });
  };

  const style = document.createElement("style");
  const label = document.createElement("div");
  label.id = "mica-preview-label";
  let hovered: Element | null = null;

  /** The label above the hovered element, or inside it at the top of the window. */
  const placeLabel = () => {
    const key = hovered?.getAttribute(ATTRIBUTE);
    const text = key ? labels.get(key) : undefined;
    if (!hovered || !text || browsing) {
      label.style.display = "none";
      return;
    }
    label.textContent = text;
    label.toggleAttribute("data-changed", hovered.hasAttribute(CHANGED));
    label.style.display = "block";
    const box = hovered.getBoundingClientRect();
    const above = box.top - label.offsetHeight - 4;
    label.style.top = `${above >= 0 ? above : box.top + 4}px`;
    label.style.left = `${Math.max(0, Math.min(box.left - 2, window.innerWidth - label.offsetWidth))}px`;
  };

  const hover = (next: Element | null) => {
    if (next === hovered) return;
    for (const element of document.querySelectorAll(`[${HOVERED}]`)) element.removeAttribute(HOVERED);
    hovered = next;
    const key = next?.getAttribute(ATTRIBUTE);
    if (key) for (const element of fieldElements(key)) element.setAttribute(HOVERED, "");
    placeLabel();
  };
  document.addEventListener("mouseover", (event) => hover(event.target instanceof Element ? event.target.closest(`[${ATTRIBUTE}]`) : null));
  document.documentElement.addEventListener("mouseleave", () => hover(null));
  window.addEventListener("scroll", placeLabel, { passive: true, capture: true });
  window.addEventListener("resize", placeLabel);

  /**
   * Outlines the elements of a field, and scrolls to the first one when it is
   * not in view. A group, such as `seo`, finds the fields in it. With a block,
   * only that block of a rich text.
   */
  const focus = (marker: FieldMarker | null, block: number | null) => {
    for (const element of document.querySelectorAll(`[${FOCUSED}]`)) element.removeAttribute(FOCUSED);
    if (!marker) return;
    let found = [...document.querySelectorAll(`[${ATTRIBUTE}]`)].filter((element) => {
      const other = markerOfKey(element.getAttribute(ATTRIBUTE));
      return !!other && other.document === marker.document && other.id === marker.id && (other.path === marker.path || other.path.startsWith(`${marker.path}.`));
    });
    if (block !== null) {
      // The block itself; a page that left it out shows the field's first element.
      const exact = found.find((element) => element.getAttribute(BLOCK) === String(block));
      found = exact ? [exact] : found.slice(0, 1);
    }
    for (const element of found) element.setAttribute(FOCUSED, "");
    const first = found[0];
    if (!first) return;
    const box = first.getBoundingClientRect();
    if (box.top >= 0 && box.bottom <= window.innerHeight) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    first.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" });
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || !isRecord(event.data) || event.data["source"] !== FROM_EDITOR) return;
    const data = event.data;
    if (data["type"] === "hello" && isRecord(data["colours"])) {
      if (!allowed(event.origin, editors)) return;
      editor = event.origin;
      const colours = data["colours"];
      if (["edit", "onEdit", "changed", "onChanged"].every((name) => isColour(colours[name]))) {
        style.textContent = styles(colours as unknown as Colours);
      }
      document.head.append(style);
      document.body.append(label);
      sent = "";
      report();
    }
    // Everything else only from the editor that said hello.
    if (event.origin !== editor) return;
    if (data["type"] === "state") {
      browsing = data["mode"] === "browse";
      document.documentElement.toggleAttribute(BROWSE, browsing);
      if (Array.isArray(data["changed"])) changed = new Set(data["changed"].filter(isMarker).map(keyOf));
      if (Array.isArray(data["labels"])) {
        labels = new Map(
          data["labels"].flatMap((item: unknown) =>
            isRecord(item) && isMarker(item["marker"]) && typeof item["label"] === "string" ? [[keyOf(item["marker"]), item["label"]] as const] : [],
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
      const block = element.getAttribute(BLOCK);
      post({ type: "select", marker, ...(block === null ? {} : { block: Number(block) }) });
    },
    true,
  );

  // Islands and scripts can add text after the load.
  let timer: ReturnType<typeof setTimeout> | undefined;
  new MutationObserver((records) => {
    // The label is the script's own element: moving it is no change of the page.
    if (records.every((record) => record.target === label || label.contains(record.target))) return;
    clearTimeout(timer);
    timer = setTimeout(report, 150);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
}

/** Starts the preview script in the editor's frame. Opened on its own, the page stays as it is. */
export function startPreview(editors: readonly string[] = []): void {
  if (window.parent !== window) start(editors);
}
