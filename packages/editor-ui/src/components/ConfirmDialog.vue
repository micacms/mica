<script setup lang="ts">
/** Confirmation dialog with focus handling and Escape-to-cancel. */

import { ref } from "vue";

import { useDialogFocus } from "@/composables/useDialogFocus";

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
// Focus the safe option, not the destructive one.
const cancelButton = ref<HTMLButtonElement | null>(null);
const { trapTab } = useDialogFocus(() => props.open, panel, cancelButton);

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && !props.busy) emit("cancel");
  trapTab(event);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 grid place-items-center bg-scrim p-4"
      @click.self="!busy && emit('cancel')"
      @keydown="onKeydown"
    >
      <div
        ref="panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        class="w-full max-w-md rounded-xl border border-line bg-raised p-5 shadow-2xl"
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
