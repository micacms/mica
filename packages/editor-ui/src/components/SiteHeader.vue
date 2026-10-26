<script setup lang="ts">
/**
 * The top of the menu: the website that the editor works on, with its
 * published address, and the state of the live preview below it. The Mica
 * icon stays beside the name, and both lead to the Overview.
 */

import { computed } from "vue";
import { ExternalLink } from "@lucide/vue";

import { usePreview } from "@/composables/usePreview";
import { useSchema } from "@/stores/schema";

const schema = useSchema();
const preview = usePreview();
const icon = `${import.meta.env.BASE_URL}brand/micacms-favicon.svg`;

const state = computed(() => preview.status.value.state);
/** The word carries the state; the dot of the status pill only repeats it (brand guide). */
const STATES = {
  live: { words: "Preview live", variant: "status-published" },
  starting: { words: "Preview starting", variant: "status-starting" },
  stopped: { words: "Preview stopped", variant: "status-stopped" },
  off: { words: "Preview off", variant: "" },
} as const;
</script>

<template>
  <div class="border-b border-line px-3 py-3">
    <!-- With the address below the name, they align at the top; a name alone sits in the middle of the icon. -->
    <div :class="['flex gap-2.5', schema.site.value?.url ? 'items-start' : 'items-center']">
      <!-- Like a logo: the icon and the name lead to the Overview. The name is the link for the keyboard. -->
      <RouterLink :to="{ name: 'dashboard' }" class="shrink-0" tabindex="-1" aria-hidden="true">
        <img :src="icon" alt="" width="28" height="28" :class="['block size-7 rounded-md', schema.site.value?.url && 'mt-px']" />
      </RouterLink>
      <div class="min-w-0 flex-1">
        <RouterLink
          :to="{ name: 'dashboard' }"
          class="line-clamp-2 text-sm leading-snug font-semibold [overflow-wrap:anywhere] text-ink transition hover:text-primary"
          :title="`${schema.siteName.value}: Overview`"
        >
          {{ schema.siteName.value }}
        </RouterLink>
        <a
          v-if="schema.site.value?.url"
          :href="schema.site.value.url"
          target="_blank"
          rel="noopener noreferrer"
          class="mt-0.5 flex w-fit max-w-full items-center gap-1 text-xs text-muted transition hover:text-ink"
        >
          <span class="truncate">{{ schema.siteHost.value }}</span>
          <ExternalLink :size="11" class="shrink-0" aria-hidden="true" />
          <span class="sr-only">(the published website, opens in a new tab)</span>
        </a>
      </div>
    </div>

    <!-- One status pill at the left edge: the words carry the state. Hidden until the first answer, so that it does not say "off" for a moment. -->
    <div v-if="preview.loaded.value" class="mt-2.5">
      <!-- A live preview whose address Mica cannot confirm can be another website: the pill says so, and why. -->
      <a
        v-if="state === 'live' && preview.address.value"
        :href="preview.address.value"
        target="_blank"
        rel="noopener noreferrer"
        :class="['status hover:underline', preview.status.value.detail ? 'status-draft' : 'status-published']"
        :title="preview.status.value.detail ?? 'Opens the preview with the saved changes, before you publish them'"
      >
        {{ preview.status.value.detail ? "Preview not confirmed" : "Preview live" }}
        <ExternalLink :size="11" aria-hidden="true" />
        <span class="sr-only">(opens a new tab)<template v-if="preview.status.value.detail">. {{ preview.status.value.detail }}</template></span>
      </a>
      <p v-else :class="['status w-fit', STATES[state].variant]" :title="preview.status.value.detail ?? undefined">
        {{ STATES[state].words }}
        <span v-if="preview.status.value.detail" class="sr-only">. {{ preview.status.value.detail }}</span>
      </p>
    </div>
  </div>
</template>
