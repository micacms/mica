<script setup lang="ts">
/**
 * The button beside the label of a localized field: it shows the field's value in the other languages, and an editor
 * can use one of them as the start of this language's value. A filled button marks a missing translation: amber when
 * the website shows the value of another language, red with "!" when it shows nothing.
 */

import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { Languages } from "@lucide/vue";

import type { FieldTranslations } from "@/composables/useFormLocale";
import { previewValue, markdocText } from "@/lib/format";
import { isEmpty, translationStatus } from "@/lib/locales";

const props = defineProps<{ translations: FieldTranslations }>();

const id = useId();
const open = ref(false);
const root = ref<HTMLElement | null>(null);
const button = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);

const status = computed(() => {
  const { field, value, locale, locales } = props.translations;
  return translationStatus(field, value, locale, locales);
});

/** What the button says on hover, and to a screen reader. */
const hint = computed(() => {
  const current = status.value;
  if (current.kind === "fallback") return `Not translated: the website shows the ${current.locale.toUpperCase()} value`;
  if (current.kind === "missing") return "Not translated: the website shows nothing";
  return "Other languages";
});

const tone = computed(() => {
  const kind = status.value.kind;
  if (kind === "fallback") return "bg-glint text-on-glint";
  if (kind === "missing") return "bg-danger-soft text-danger";
  return "text-muted hover:bg-subtle hover:text-ink";
});

/** The other languages: their value as text, and whether the website shows it in this language. */
const others = computed(() => {
  const { field, value, locale, locales } = props.translations;
  const current = status.value;
  return locales.list
    .filter((other) => other !== locale)
    .map((other) => {
      const own = field.fields[other];
      const stored = value[other];
      const text = own?.kind === "richText" && typeof stored === "string" ? markdocText(stored) : own?.kind === "text" || own?.kind === "textarea" ? String(stored ?? "") : previewValue(stored, own);
      return { locale: other, empty: isEmpty(stored), text, shown: current.kind === "fallback" && current.locale === other };
    });
});

const replaces = computed(() => status.value.kind === "translated");

function toggle(): void {
  open.value = !open.value;
}

function close(focusButton: boolean): void {
  open.value = false;
  if (focusButton) button.value?.focus();
}

/** Escape closes the open panel, and goes no further: an overlay around the form stays open. */
function onEscape(event: KeyboardEvent): void {
  if (!open.value) return;
  event.stopPropagation();
  close(true);
}

function use(from: string): void {
  open.value = false;
  props.translations.use(from);
}

/** A click outside closes the panel, as the focus that leaves it does. */
function onPointerDown(event: PointerEvent): void {
  if (root.value && !root.value.contains(event.target as Node)) close(false);
}

/** The focus that moves to another control closes the panel. Without a target, as after a click in Safari, the click decides. */
function onFocusOut(event: FocusEvent): void {
  const target = event.relatedTarget as Node | null;
  if (open.value && target && root.value && !root.value.contains(target)) close(false);
}

watch(open, async (isOpen) => {
  if (isOpen) {
    document.addEventListener("pointerdown", onPointerDown);
    await nextTick();
    panel.value?.focus();
  } else {
    document.removeEventListener("pointerdown", onPointerDown);
  }
});

onBeforeUnmount(() => document.removeEventListener("pointerdown", onPointerDown));
</script>

<template>
  <div ref="root" class="relative -my-1 shrink-0" @focusout="onFocusOut" @keydown.esc="onEscape">
    <!-- `data-field-action`: not the control that `focusField` focuses. -->
    <button
      ref="button"
      type="button"
      data-field-action
      :class="['group relative flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-sm px-1 transition', tone]"
      :aria-expanded="open"
      aria-haspopup="dialog"
      :aria-controls="open ? id : undefined"
      @click="toggle"
    >
      <Languages :size="14" aria-hidden="true" />
      <span v-if="status.kind === 'missing'" class="text-xs leading-none font-bold" aria-hidden="true">!</span>
      <span class="sr-only">{{ translations.label }}: {{ hint }}</span>
      <span v-if="!open" class="tooltip right-0 group-hover:tooltip-shown group-focus-visible:tooltip-shown" aria-hidden="true">{{ hint }}</span>
    </button>

    <div
      v-if="open"
      :id="id"
      ref="panel"
      role="dialog"
      :aria-label="`${translations.label} in other languages`"
      tabindex="-1"
      class="absolute top-full right-0 z-30 mt-1.5 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-line bg-surface p-3 text-left shadow-lg outline-none"
    >
      <p class="text-xs font-semibold text-ink">{{ translations.label }} in other languages</p>
      <p v-if="status.kind === 'fallback' || status.kind === 'missing'" class="mt-0.5 text-xs text-muted">{{ hint }}.</p>

      <ul class="mt-2 divide-y divide-line">
        <li v-for="other in others" :key="other.locale" class="py-2 first:pt-1 last:pb-0">
          <div class="flex items-center gap-2">
            <span class="badge" :lang="other.locale">{{ other.locale.toUpperCase() }}</span>
            <span v-if="other.shown" class="text-xs text-muted">The website shows this</span>
            <span v-if="other.empty" class="ml-auto text-xs text-muted">Empty</span>
            <button
              v-else-if="!translations.locked"
              type="button"
              class="btn-ghost ml-auto px-2 py-0.5 text-xs"
              @click="use(other.locale)"
            >
              {{ replaces ? "Replace with this" : "Use" }}<span class="sr-only"> the {{ other.locale.toUpperCase() }} value</span>
            </button>
          </div>
          <p v-if="!other.empty" :lang="other.locale" class="mt-1 line-clamp-4 text-sm whitespace-pre-line break-words text-ink-soft">
            {{ other.text }}
          </p>
        </li>
      </ul>
    </div>
  </div>
</template>
