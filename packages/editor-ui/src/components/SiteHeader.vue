<script setup lang="ts">
/**
 * The top of the menu: the website that the editor works on, with its
 * published address, and the state of the live preview below it. The Mica
 * icon stays beside the name, and both lead to the Overview.
 */

import { ExternalLink } from "@lucide/vue";

import PreviewStatus from "@/components/PreviewStatus.vue";
import { usePreview } from "@/composables/usePreview";
import { useSchema } from "@/stores/schema";

const schema = useSchema();
const preview = usePreview();
const icon = `${import.meta.env.BASE_URL}brand/mica-favicon.svg`;
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

    <!-- Hidden until the first answer, so that it does not say "No preview" for a moment. -->
    <div v-if="preview.loaded.value" class="mt-2.5">
      <PreviewStatus />
    </div>
  </div>
</template>
