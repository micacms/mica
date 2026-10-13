<script setup lang="ts">
import { X } from "@lucide/vue";

import { useToast } from "@/stores/toast";

const { toasts, dismiss } = useToast();

const STYLES: Record<string, string> = {
  success: "border-success/15 bg-success-soft text-success",
  error: "border-danger/15 bg-danger-soft text-danger",
  info: "border-info/15 bg-info-soft text-info",
};

// role="alert" is assertive and role="status" is polite; both regions exist before a toast appears.
const REGIONS = [
  { role: "alert", holds: (toast: { kind: string }) => toast.kind === "error" },
  { role: "status", holds: (toast: { kind: string }) => toast.kind !== "error" },
];

const DOTS: Record<string, string> = {
  success: "bg-success",
  error: "bg-danger",
  info: "bg-info",
};
</script>

<template>
  <!-- Two live regions: a failure interrupts a screen reader; other news waits its turn. -->
  <div class="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end">
    <div
      v-for="region in REGIONS"
      :key="region.role"
      :role="region.role"
      class="flex w-full flex-col items-center gap-2 sm:items-end"
    >
      <div
        v-for="toast in toasts.filter(region.holds)"
        :key="toast.id"
        :class="[
          'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border p-4 shadow-lg',
          STYLES[toast.kind],
        ]"
      >
        <span :class="['mt-1.5 h-2 w-2 shrink-0 rounded-full', DOTS[toast.kind]]" aria-hidden="true" />

        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium">{{ toast.message }}</p>
          <p v-if="toast.detail" class="mt-0.5 text-sm opacity-80">{{ toast.detail }}</p>
        </div>

        <button
          type="button"
          class="-m-1 shrink-0 rounded p-1 opacity-60 hover:opacity-100"
          @click="dismiss(toast.id)"
        >
          <X :size="16" aria-hidden="true" />
          <span class="sr-only">Dismiss</span>
        </button>
      </div>
    </div>
  </div>
</template>
