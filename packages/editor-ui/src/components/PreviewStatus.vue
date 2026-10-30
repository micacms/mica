<script setup lang="ts">
/**
 * The state of the live preview, at the top of the menu: a status pill whose
 * popover says why and what to do, and opens the preview while it is live.
 * The word carries the state; the dot of the pill only repeats it (brand guide).
 */

import { computed } from "vue";
import { ExternalLink } from "@lucide/vue";

import StatusPopover from "@/components/StatusPopover.vue";
import { usePreview } from "@/composables/usePreview";

const preview = usePreview();
const status = computed(() => preview.status.value);
/** A live preview whose address Mica cannot confirm can be another website. */
const unconfirmed = computed(() => status.value.state === "live" && !!status.value.detail);

const pill = computed(() => {
  switch (status.value.state) {
    case "live":
      return unconfirmed.value ? { label: "Preview not confirmed", tone: "status-warning" } : { label: "Preview live", tone: "status-success" };
    case "starting":
      return { label: "Preview starting", tone: "status-busy" };
    case "stopped":
      return { label: "Preview stopped", tone: "status-error" };
    default:
      return { label: "No preview", tone: "" };
  }
});

const FALLBACK = { starting: "The preview is starting.", stopped: "The preview stopped.", off: "This Mica has no preview." } as const;
const detail = computed(() => status.value.detail ?? (status.value.state === "live" ? null : FALLBACK[status.value.state]));

/** The address without its scheme, such as `localhost:4321` or `preview.example.com/docs`. */
const host = computed(() => {
  const address = status.value.state === "live" ? status.value.address : null;
  if (!address) return null;
  const url = new URL(address);
  return `${url.host}${url.pathname.replace(/\/+$/, "")}`;
});

const name = computed(() => [pill.value.label, detail.value].filter(Boolean).join(". "));
</script>

<template>
  <StatusPopover :name="name" :tone="pill.tone">
    <template #pill>
      <span aria-hidden="true">{{ pill.label }}</span>
    </template>

    <template #default="{ close }">
      <p v-if="host && !unconfirmed">It shows your saved changes before you publish them.</p>
      <p v-else-if="detail" :class="unconfirmed && 'font-medium text-warning'">{{ detail }}</p>

      <template v-if="host && status.address">
        <p class="truncate font-mono text-ink">{{ host }}</p>
        <a :href="status.address" target="_blank" rel="noopener noreferrer" class="btn-secondary px-2.5 py-1 text-xs" @click="close()">
          <ExternalLink :size="13" aria-hidden="true" />
          Open in a new tab
        </a>
      </template>

      <div v-if="status.state === 'stopped'" class="border-t border-line pt-2">
        <RouterLink :to="{ name: 'system' }" class="font-medium text-muted underline-offset-2 hover:text-ink hover:underline" @click="close()">
          Open the System page
        </RouterLink>
      </div>
    </template>
  </StatusPopover>
</template>
