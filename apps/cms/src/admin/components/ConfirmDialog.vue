<script setup lang="ts">
/** Confirmation dialog with focus handling and Escape-to-cancel. */

import { nextTick, ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
    busy?: boolean;
  }>(),
  { confirmLabel: "Confirm", cancelLabel: "Cancel", destructive: false, busy: false },
);

const emit = defineEmits<{ confirm: []; cancel: [] }>();

const panel = ref<HTMLElement | null>(null);
const cancelButton = ref<HTMLButtonElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      previouslyFocused?.focus();
      return;
    }
    previouslyFocused = document.activeElement as HTMLElement | null;
    await nextTick();
    // Focus the safe option, not the destructive one.
    cancelButton.value?.focus();
  },
);

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && !props.busy) emit("cancel");
  if (event.key !== "Tab" || !panel.value) return;

  const focusable = panel.value.querySelectorAll<HTMLElement>("button:not([disabled])");
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      @click.self="!busy && emit('cancel')"
      @keydown="onKeydown"
    >
      <div
        ref="panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        class="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"
      >
        <h2 id="confirm-title" class="text-base font-semibold">{{ title }}</h2>

        <div id="confirm-body" class="mt-2 text-sm text-muted">
          <slot />
        </div>

        <div class="mt-5 flex justify-end gap-2">
          <button
            ref="cancelButton"
            type="button"
            class="btn-secondary"
            :disabled="busy"
            @click="emit('cancel')"
          >
            {{ cancelLabel }}
          </button>
          <button
            type="button"
            :class="destructive ? 'btn-danger' : 'btn-primary'"
            :disabled="busy"
            @click="emit('confirm')"
          >
            {{ busy ? "Working…" : confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
