<script setup lang="ts">
/**
 * The live preview beside the form: the page in the website's dev server, which
 * reads the saved drafts and loads the page again after each save. The page's
 * preview script (`@micacms/astro/preview`) marks the text fields.
 *
 * In Edit mode, a click on a field of the form's document goes to it. A click on
 * a field of another document opens its form, when it has a page of its own;
 * else the overlay form. The form follows the preview: in Edit mode, a page with
 * a document of its own opens that document's form, also after a link was
 * followed in Browse mode. Fields with unpublished changes get the glint
 * outline. When a field of a form gets the focus, the page scrolls to its text.
 *
 * A name on the page can come from a related entry, such as the author of an
 * article. A click goes to the relation field of the form's document; the
 * hover label also offers to edit the related entry, in the overlay form. The
 * focus of a relation field shows its entry on the page.
 */

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter, type RouteLocationRaw } from "vue-router";
import { ChevronLeft, ChevronRight, ExternalLink, LoaderCircle, RotateCw, TriangleAlert } from "@lucide/vue";

import { chooseFormLocale } from "@/composables/useFormLocale";
import { usePreview } from "@/composables/usePreview";
import { usePreviewPane, type PreviewMode } from "@/composables/usePreviewPane";
import { fieldAt, fieldLabel, fieldPaths } from "@/lib/field-labels";
import { FIELD_BLOCK, focusField } from "@/lib/focus";
import { withoutOverlay } from "@/lib/overlay-address";
import { documentsAtPath } from "@/lib/pages";
import { changedMarkers, isPreviewMarker, type ChangedMarker, type PreviewMarker } from "@/lib/preview-changes";
import { linkKey, linkTarget, relationLinks, type RelationLink } from "@/lib/preview-relations";
import { useSchema } from "@/stores/schema";
import { api } from "@/api";
import { useStaging } from "@/stores/staging";

const pane = usePreviewPane();
const devServer = usePreview();
const route = useRoute();
const router = useRouter();
const schema = useSchema();
const staging = useStaging();

const iframe = ref<HTMLIFrameElement | null>(null);
const dragging = ref(false);
const origin = computed(() => (pane.frame.value ? new URL(pane.frame.value).origin : null));
/** The address that the frame shows, as its script last said: after a followed link, not the form's page. */
const shown = ref<string | null>(null);
/** The fields in the page, as its script last named them. */
const markers = ref<PreviewMarker[]>([]);
const changed = ref<ChangedMarker[]>([]);

const MIN_WIDTH = 320;
/** A drag that leaves less than this folds the preview away. */
const FOLD_WIDTH = MIN_WIDTH / 2;
/** The form keeps at least this much. */
const FORM_WIDTH = 480;
const clamp = (value: number) => Math.round(Math.min(Math.max(value, MIN_WIDTH), Math.max(MIN_WIDTH, window.innerWidth - FORM_WIDTH)));

const modes: Array<{ value: PreviewMode; label: string; hint: string }> = [
  { value: "edit", label: "Edit", hint: "A click on a text opens its field. Alt-click follows a link." },
  { value: "browse", label: "Browse", hint: "The page acts as the website does." },
];

function post(message: Record<string, unknown>): void {
  // A plain copy: postMessage cannot clone Vue's reactive proxies.
  const plain = JSON.parse(JSON.stringify({ source: "mica-editor", ...message })) as unknown;
  if (origin.value) iframe.value?.contentWindow?.postMessage(plain, origin.value);
}

/** A token's value in the current light or dark mode, for the page's outlines. */
function token(name: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  document.body.append(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}

/** A token's value as written, such as a radius. */
const cssToken = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function hello(): void {
  post({
    type: "hello",
    colours: {
      edit: token("--mica-primary"),
      onEdit: token("--mica-on-primary"),
      changed: token("--mica-glint"),
      onChanged: token("--mica-on-glint"),
    },
    // The brand's radii: panels for the frames, chips for the buttons of the label.
    radii: { frame: cssToken("--radius-md"), chip: cssToken("--radius-sm") },
  });
}

/** The document of the form on the page, from the address. */
const mainDocument = computed(() => {
  if (route.name === "entry") return { document: String(route.params["collection"]), id: String(route.params["id"]) };
  if (route.name === "singleton") return { document: String(route.params["name"]), id: String(route.params["name"]) };
  return null;
});

const sameDocument = (a: { document: string; id: string } | null, b: { document: string; id: string }) =>
  !!a && a.document === b.document && a.id === b.id;

/** The entries that the form's document links to, read again with each page that the preview loads. */
const links = ref(new Map<string, RelationLink>());

async function loadLinks(): Promise<void> {
  const main = mainDocument.value;
  const collection = main ? schema.collection(main.document) : undefined;
  const fields = collection?.fields ?? (main ? schema.singleton(main.document)?.fields : undefined);
  if (!main || !fields) {
    links.value = new Map();
    return;
  }
  try {
    const saved = collection ? await api.entries.get(main.document, main.id) : await api.singletons.get(main.document);
    links.value = relationLinks(fields, saved.data);
  } catch {
    // Without them, a related name still opens its own entry.
    links.value = new Map();
  }
}

/** The relation field of the form's document that links to the marker's entry, if any. */
const linkOf = (marker: PreviewMarker): RelationLink | undefined => links.value.get(linkKey(marker.document, marker.id));

/** On hover: the field's name in an open form, else the document that the field belongs to. */
function labelOf(marker: PreviewMarker): string {
  const collection = schema.collection(marker.document);
  const singleton = collection ? undefined : schema.singleton(marker.document);
  const fields = collection?.fields ?? singleton?.fields;
  if (sameDocument(mainDocument.value, marker) || sameDocument(pane.overlay.value, marker)) {
    return (fields && fieldLabel(fields, marker.path)) ?? marker.path;
  }
  // Another document's field: which document, and which field, such as "Labels: Map".
  const field = fields ? fieldLabel(fields, marker.path) : null;
  if (singleton) return field ? `${singleton.label}: ${field}` : singleton.label;
  return collection ? `${collection.labelSingular}: ${marker.id}` : marker.document;
}

/** The field paths of each model on the page, and of the form's: the page gives the elements that its templates mark to a document with them. */
function models(): Record<string, string[]> {
  const names = new Set([...markers.value.map((marker) => marker.document), ...(mainDocument.value ? [mainDocument.value.document] : [])]);
  return Object.fromEntries(
    [...names].flatMap((name) => {
      const fields = schema.collection(name)?.fields ?? schema.singleton(name)?.fields;
      return fields ? [[name, fieldPaths(fields)] as const] : [];
    }),
  );
}

/**
 * What a click on a field does, for its label: go to the field of the form, open
 * another form (a document with a page), or open the overlay form, which the
 * page marks with ↗. The same as `select`.
 */
function opensOf(marker: PreviewMarker): "field" | "form" | "overlay" {
  if (sameDocument(mainDocument.value, marker) || linkOf(marker)) return "field";
  const page = schema.collection(marker.document)?.url ?? schema.singleton(marker.document)?.url;
  return page ? "form" : "overlay";
}

function sendState(): void {
  post({
    type: "state",
    mode: pane.mode.value,
    models: models(),
    main: mainDocument.value,
    changed: changed.value,
    labels: markers.value.map((marker) => {
      // A related entry: the label names the relation field, and its button the entry.
      const link = sameDocument(mainDocument.value, marker) ? undefined : linkOf(marker);
      return link
        ? { marker, label: link.label, opens: "field", secondary: labelOf(marker) }
        : { marker, label: labelOf(marker), opens: opensOf(marker) };
    }),
  });
}

/** The field that has the focus in the main form or in the overlay, as a marker of the page; in a rich text, with the cursor's block. */
const focused = ref<{ marker: PreviewMarker; block?: number } | null>(null);

function focusOf(target: EventTarget | null, block?: number): typeof focused.value {
  const element = target instanceof Element ? target : null;
  const path = element?.closest("[data-field-path]")?.getAttribute("data-field-path") ?? null;
  const form = element?.closest("[data-document-form]");
  const owner = !form ? null : form.id === "main" ? mainDocument.value : pane.overlay.value;
  if (!path || !owner) return null;
  return { marker: { document: owner.document, id: owner.id, path }, ...(block === undefined ? {} : { block }) };
}

function setFocused(next: typeof focused.value): void {
  if (JSON.stringify(next) !== JSON.stringify(focused.value)) focused.value = next;
}

function onFocusIn(event: FocusEvent): void {
  const next = focusOf(event.target);
  // A rich text reports its block before `focusin` comes: the same field keeps it.
  const same = next && focused.value?.block !== undefined && JSON.stringify(next.marker) === JSON.stringify(focused.value.marker);
  if (!same) setFocused(next);
}
// The cursor of a rich text moved to another paragraph: the preview shows that one.
const onFieldBlock = (event: Event) => {
  const block: unknown = (event as CustomEvent).detail;
  if (typeof block === "number") setFocused(focusOf(event.target, block));
};

/**
 * Sends the focused field to the page. A relation field of the form's document
 * has no text there: the page shows the linked entry instead, all of it.
 */
function sendFocus(): void {
  const current = focused.value;
  if (current && sameDocument(mainDocument.value, current.marker)) {
    const linked = [...links.value].find(
      ([, link]) => link.path === current.marker.path && (current.block === undefined || link.block === undefined || link.block === current.block),
    );
    if (linked) {
      const { collection, id } = linkTarget(linked[0]);
      post({ type: "focus", marker: { document: collection, id, path: "" } });
      return;
    }
  }
  post({ type: "focus", marker: current?.marker ?? null, block: current?.block });
}
watch(focused, sendFocus);

async function findChanges(): Promise<void> {
  const isRichText = (marker: PreviewMarker) => {
    const fields = schema.collection(marker.document)?.fields ?? schema.singleton(marker.document)?.fields;
    return !!fields && fieldAt(fields, marker.path)?.kind === "richText";
  };
  changed.value = markers.value.length === 0 ? [] : await changedMarkers(markers.value, staging.edits.value, isRichText);
}

/** Goes to the field that a click in the page names; for a block of rich text, to that block. */
async function select(marker: PreviewMarker, block?: number): Promise<void> {
  const collection = schema.collection(marker.document);
  const singleton = collection ? undefined : schema.singleton(marker.document);
  if (!collection && !singleton) return;
  if (sameDocument(mainDocument.value, marker)) {
    await focusMain(marker.path, block);
    return;
  }
  // A related entry: the relation field of the form's document that shows it here.
  const link = linkOf(marker);
  if (link) {
    await focusMain(link.path, link.block);
    return;
  }
  // A document with a page of its own opens its form, and the preview its page.
  if (collection?.url || singleton?.url) {
    const params: Record<string, string> = collection ? { collection: marker.document, id: marker.id } : { name: marker.document };
    await openForm({ name: collection ? "entry" : "singleton", params, query: { field: marker.path } });
    return;
  }
  pane.openOverlay({ kind: collection ? "entry" : "singleton", document: marker.document, id: marker.id, field: marker.path });
}

/** Goes to a field of the main form; an overlay over it closes first, and leaves the address. */
async function focusMain(path: string, block?: number): Promise<void> {
  const hadOverlay = !!pane.overlay.value;
  if (!pane.closeOverlay()) return;
  if (hadOverlay) void router.replace({ query: withoutOverlay(route.query) });
  await nextTick();
  focusField(path, document.getElementById("main") ?? document, { block });
}

/** A path of the dev server without its `base`, as the model's `url` options name it. */
function sitePath(path: string): string {
  const base = devServer.address.value ? new URL(devServer.address.value).pathname.replace(/\/+$/, "") : "";
  return base && path.startsWith(base) ? path.slice(base.length) || "/" : path;
}

/** In Edit mode, the form follows the page in the preview, when that page has a document of its own, and its language. */
async function follow(): Promise<void> {
  if (pane.mode.value !== "edit" || !pane.visible.value || !shown.value) return;
  // Only a document that the page shows: an address such as /news/unknown/ matches a pattern, but has no entry.
  const target = documentsAtPath(sitePath(new URL(shown.value).pathname), schema.schema.value).find((candidate) => {
    const document = candidate.params["collection"] ?? candidate.params["name"];
    const id = candidate.params["id"] ?? candidate.params["name"];
    return markers.value.some((marker) => marker.document === document && marker.id === id);
  });
  if (!target) return;
  const form = { name: target.name, params: target.params };
  if (router.resolve(form).path === route.path) {
    if (target.locale) chooseFormLocale(target.locale);
    return;
  }
  // The language changes with the new form, not before: the old form would send its own page to the frame.
  following = true;
  try {
    if ((await openForm(form)) && target.locale) chooseFormLocale(target.locale);
  } finally {
    following = false;
  }
}

/** While the form follows the page of the frame, the frame keeps that page, also when the form's language changes. */
let following = false;

/**
 * Opens another main form. The overlay belongs to the page that it was opened
 * on, so it closes first; when the form below keeps its page (the editor chose
 * to stay), the address loses the overlay too.
 */
async function openForm(target: RouteLocationRaw): Promise<boolean> {
  const hadOverlay = !!pane.overlay.value;
  if (!pane.closeOverlay()) return false;
  const failure = await router.push(target);
  if (failure && hadOverlay) await router.replace({ query: withoutOverlay(route.query) });
  return !failure;
}

function onMessage(event: MessageEvent): void {
  if (event.source !== iframe.value?.contentWindow || event.origin !== origin.value) return;
  const data: unknown = event.data;
  if (typeof data !== "object" || data === null || (data as Record<string, unknown>)["source"] !== "mica-preview") return;
  const message = data as Record<string, unknown>;
  if (message["type"] === "fields" && Array.isArray(message["markers"])) {
    if (typeof message["path"] === "string") shown.value = `${origin.value}${message["path"]}`;
    markers.value = message["markers"].filter(isPreviewMarker);
    void follow();
    void loadLinks().then(sendState);
    sendState();
    // After a reload, the page goes back to the field that has the focus.
    sendFocus();
    void staging.refresh().then(findChanges);
  }
  // The button in the hover label of a related entry: edit that entry in the overlay form, at the clicked field.
  if (message["type"] === "select-secondary" && isPreviewMarker(message["marker"])) {
    const marker = message["marker"];
    if (schema.collection(marker.document)) pane.openOverlay({ kind: "entry", document: marker.document, id: marker.id, field: marker.path });
  }
  if (message["type"] === "select" && isPreviewMarker(message["marker"])) {
    void select(message["marker"], typeof message["block"] === "number" ? message["block"] : undefined);
  }
}

// A save, a discard or a publication changes which fields differ.
watch(() => staging.status.value, () => void findChanges());
// Another form or overlay changes the labels.
watch([changed, () => pane.mode.value, mainDocument, () => pane.overlay.value], sendState);
// Back in Edit mode after browsing: the form of the page that the preview shows.
watch(
  () => pane.mode.value,
  (mode) => mode === "edit" && void follow(),
);

const sameAddress = (a: string | null, b: string | null) => !!a && !!b && a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

/**
 * The frame loads the form's page, unless it shows that page already: after
 * the form followed the preview, loading it again would only flash. A new
 * frame, after the pane waited for the preview, loads it always.
 */
let loadedIn: HTMLIFrameElement | null = null;
watch(
  [() => pane.frame.value, iframe],
  ([url, element]) => {
    if (!url || !element || (element === loadedIn && (following || sameAddress(url, shown.value)))) return;
    element.src = url;
    loadedIn = element;
  },
  { immediate: true, flush: "post" },
);

onMounted(() => {
  window.addEventListener("message", onMessage);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener(FIELD_BLOCK, onFieldBlock);
});
onBeforeUnmount(() => {
  window.removeEventListener("message", onMessage);
  document.removeEventListener("focusin", onFocusIn);
  document.removeEventListener(FIELD_BLOCK, onFieldBlock);
});

/** Loads the page that the frame shows again; without its script, the form's page. */
function reload(): void {
  if (shown.value) post({ type: "reload" });
  else if (iframe.value && pane.frame.value) iframe.value.src = pane.frame.value;
}

function startDrag(event: PointerEvent): void {
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  dragging.value = true;
}

/** A drag to the right edge folds the preview away; a drag from there opens it again. */
function drag(event: PointerEvent): void {
  if (!dragging.value) return;
  const wanted = window.innerWidth - event.clientX;
  pane.open.value = wanted >= FOLD_WIDTH;
  if (pane.open.value) pane.width.value = clamp(wanted);
}

function onHandleKey(event: KeyboardEvent): void {
  const step = event.shiftKey ? 96 : 32;
  if (event.key === "Enter") pane.toggle();
  else if (event.key === "ArrowLeft") pane.open.value ? (pane.width.value = clamp(pane.width.value + step)) : (pane.open.value = true);
  else if (event.key === "ArrowRight") pane.width.value = clamp(pane.width.value - step);
  else return;
  event.preventDefault();
}
</script>

<template>
  <aside
    v-show="pane.visible.value"
    aria-label="Preview"
    class="sticky top-0 hidden h-screen shrink-0 self-start bg-surface lg:flex"
    :style="{ width: pane.open.value ? `${clamp(pane.width.value)}px` : undefined }"
  >
    <!--
      The divider stays when the preview is folded away: a drag or its button opens it again.
      Open, it is a thin line; folded, a wider strip in the primary colour that says "Preview".
    -->
    <div :class="['relative shrink-0 transition-[width]', pane.open.value ? 'w-3' : 'w-9 border-l border-primary/40 bg-primary-soft']">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Width of the preview"
        aria-controls="preview-content"
        :aria-valuenow="pane.open.value ? clamp(pane.width.value) : 0"
        :aria-valuemin="0"
        tabindex="0"
        class="group absolute inset-0 cursor-col-resize focus-visible:outline-none"
        @pointerdown="startDrag"
        @pointermove="drag"
        @pointerup="dragging = false"
        @pointercancel="dragging = false"
        @dblclick="pane.toggle()"
        @keydown="onHandleKey"
      >
        <div
          v-if="pane.open.value"
          class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line transition-all group-hover:w-1 group-hover:bg-primary group-focus-visible:w-1 group-focus-visible:bg-primary"
          :class="dragging && 'w-1 bg-primary'"
        />
      </div>
      <button
        type="button"
        :class="[
          'absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center gap-2 rounded-full transition',
          pane.open.value
            ? 'size-6 justify-center border border-line bg-surface text-muted shadow-sm hover:text-ink'
            : 'bg-primary px-1 py-2.5 text-on-primary shadow-sm hover:bg-primary-hover',
        ]"
        :aria-expanded="pane.open.value"
        aria-controls="preview-content"
        :title="pane.open.value ? 'Fold the preview away' : 'Show the preview'"
        @click="pane.toggle()"
      >
        <ChevronRight v-if="pane.open.value" :size="14" aria-hidden="true" />
        <template v-else>
          <ChevronLeft :size="14" aria-hidden="true" />
          <span class="text-xs font-semibold [writing-mode:vertical-rl]" aria-hidden="true">Preview</span>
        </template>
        <span class="sr-only">{{ pane.open.value ? "Fold the preview away" : "Show the preview" }}</span>
      </button>
    </div>

    <div v-show="pane.open.value" id="preview-content" class="flex min-w-0 flex-1 flex-col">
      <div class="flex h-14 shrink-0 items-center gap-1 border-b border-line px-3">
        <p class="min-w-0 flex-1 truncate text-sm font-semibold">Preview</p>
        <template v-if="!pane.waiting.value">
        <div role="group" aria-label="What a click does" class="mr-1 flex rounded-full border border-line bg-surface p-0.5">
          <button
            v-for="option in modes"
            :key="option.value"
            type="button"
            :aria-pressed="pane.mode.value === option.value"
            :title="option.hint"
            class="rounded-full px-2.5 py-0.5 text-xs font-medium text-ink-soft transition aria-pressed:bg-primary aria-pressed:text-on-primary"
            @click="pane.mode.value = option.value"
          >
            {{ option.label }}
          </button>
        </div>
        <button type="button" class="btn-ghost px-2" title="Load the page again" @click="reload">
          <RotateCw :size="15" aria-hidden="true" />
          <span class="sr-only">Load the page again</span>
        </button>
        <a v-if="pane.frame.value" :href="shown ?? pane.frame.value" target="_blank" rel="noopener noreferrer" class="btn-ghost px-2" title="Open in a new tab">
          <ExternalLink :size="15" aria-hidden="true" />
          <span class="sr-only">Open in a new tab</span>
        </a>
        </template>
      </div>

      <!-- A form with a page waits for a preview that starts, or that stopped: say so in place of the page. -->
      <div v-if="pane.waiting.value" role="status" class="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <LoaderCircle v-if="devServer.status.value.state === 'starting'" :size="20" class="text-muted motion-safe:animate-spin" aria-hidden="true" />
        <TriangleAlert v-else :size="20" class="text-danger" aria-hidden="true" />
        <p class="text-sm font-semibold">{{ devServer.status.value.state === "starting" ? "The preview is starting" : "The preview stopped" }}</p>
        <p v-if="devServer.status.value.detail" class="max-w-xs text-sm text-muted">{{ devServer.status.value.detail }}</p>
      </div>

      <!-- A live preview whose address is not confirmed can show another website: say it above the page. -->
      <p
        v-if="pane.frame.value && !pane.waiting.value && devServer.status.value.state === 'live' && devServer.status.value.detail"
        role="status"
        class="flex items-start gap-2 border-b border-line bg-warning-soft px-3 py-2 text-xs"
      >
        <TriangleAlert :size="14" class="mt-px shrink-0" aria-hidden="true" />
        {{ devServer.status.value.detail }}
      </p>

      <!-- While the handle moves, the page must not take the pointer. -->
      <iframe
        v-if="pane.frame.value && !pane.waiting.value"
        ref="iframe"
        title="Preview of the page"
        class="min-h-0 w-full flex-1 bg-ground"
        :class="dragging && 'pointer-events-none'"
        @load="hello"
      />
    </div>
  </aside>
</template>
