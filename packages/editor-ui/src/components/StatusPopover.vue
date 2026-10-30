<script setup lang="ts">
/**
 * A status pill that opens its details: a click or Enter keeps the popover open,
 * a mouse hover shows it while the pointer stays. Escape, a click outside and
 * the focus on another control close it. The pill's content and the popover's
 * come from the slots; the popover's slot gets `close`.
 */

import { nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { ChevronDown } from "@lucide/vue";

defineProps<{
  /** The name of the pill and its popover for a screen reader: all that the pill says. */
  name: string;
  /** The pill's tone, such as `status-success`. */
  tone: string;
}>();

const id = useId();
const open = ref(false);
const byHover = ref(false);
const root = ref<HTMLElement | null>(null);
const button = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);

function toggle(): void {
  if (open.value && byHover.value) {
    byHover.value = false;
    void nextTick(() => panel.value?.focus());
    return;
  }
  byHover.value = false;
  open.value = !open.value;
}

function close(focusButton = false): void {
  open.value = false;
  byHover.value = false;
  if (focusButton) button.value?.focus();
}

function onPointerEnter(event: PointerEvent): void {
  if (event.pointerType !== "mouse" || open.value) return;
  byHover.value = true;
  open.value = true;
}

function onPointerLeave(): void {
  if (byHover.value) close();
}

/** Escape closes the open panel, and goes no further: an overlay around the pill stays open. */
function onEscape(event: KeyboardEvent): void {
  if (!open.value) return;
  event.stopPropagation();
  close(true);
}

function onPointerDown(event: PointerEvent): void {
  if (root.value && !root.value.contains(event.target as Node)) close();
}

/** The focus that moves to another control closes the panel. Without a target, as after a click in Safari, the click decides. */
function onFocusOut(event: FocusEvent): void {
  const target = event.relatedTarget as Node | null;
  if (open.value && target && root.value && !root.value.contains(target)) close();
}

watch(open, async (isOpen) => {
  if (isOpen) {
    document.addEventListener("pointerdown", onPointerDown);
    await nextTick();
    if (!byHover.value) panel.value?.focus();
  } else {
    document.removeEventListener("pointerdown", onPointerDown);
  }
});

onBeforeUnmount(() => document.removeEventListener("pointerdown", onPointerDown));
</script>

<template>
  <div ref="root" class="relative shrink-0" @focusout="onFocusOut" @keydown.esc="onEscape" @pointerenter="onPointerEnter" @pointerleave="onPointerLeave">
    <button
      ref="button"
      type="button"
      :class="['status cursor-pointer hover:ring-1 hover:ring-line-strong', tone]"
      :aria-expanded="open"
      aria-haspopup="dialog"
      :aria-controls="open ? id : undefined"
      @click="toggle"
    >
      <slot name="pill" />
      <ChevronDown :size="12" class="-mr-1 text-muted" aria-hidden="true" />
      <span class="sr-only">{{ name }}</span>
    </button>

    <div
      v-if="open"
      :id="id"
      ref="panel"
      role="dialog"
      :aria-label="name"
      tabindex="-1"
      class="absolute top-full left-0 z-30 mt-1.5 w-72 max-w-[calc(100vw-2rem)] space-y-2 rounded-md border border-line bg-surface p-3 text-xs text-ink-soft shadow-lg outline-none"
    >
      <slot :close="close" />
    </div>
  </div>
</template>
