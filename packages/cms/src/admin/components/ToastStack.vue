<script setup lang="ts">
import { useToast } from "@/stores/toast";

const { toasts, dismiss } = useToast();

const STYLES: Record<string, string> = {
  success: "border-success/40 bg-raised",
  error: "border-danger/40 bg-raised",
  info: "border-line bg-raised",
};

const DOTS: Record<string, string> = {
  success: "bg-success",
  error: "bg-danger",
  info: "bg-muted",
};
</script>

<template>
  <!-- assertive so a failed save interrupts a screen reader rather than queueing -->
  <div
    class="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
    role="status"
    aria-live="assertive"
  >
    <div
      v-for="toast in toasts"
      :key="toast.id"
      :class="[
        'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border p-3.5 shadow-lg',
        STYLES[toast.kind],
      ]"
    >
      <span :class="['mt-1.5 h-2 w-2 shrink-0 rounded-full', DOTS[toast.kind]]" aria-hidden="true" />

      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium">{{ toast.message }}</p>
        <p v-if="toast.detail" class="mt-0.5 text-xs text-muted">{{ toast.detail }}</p>
      </div>

      <button
        type="button"
        class="-m-1 shrink-0 rounded p-1 text-muted hover:text-ink"
        @click="dismiss(toast.id)"
      >
        <svg viewBox="0 0 20 20" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.75">
          <path d="M5 5l10 10M15 5L5 15" stroke-linecap="round" />
        </svg>
        <span class="sr-only">Dismiss</span>
      </button>
    </div>
  </div>
</template>
