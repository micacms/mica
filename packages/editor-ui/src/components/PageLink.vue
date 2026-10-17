<script setup lang="ts">
/** "Open on website": a plain link to the page, in a new tab. */

import { ExternalLink } from "@lucide/vue";

defineProps<{ href: string }>();
</script>

<template>
  <a :href="href" target="_blank" rel="noopener noreferrer" class="btn-ghost">
    <ExternalLink :size="15" aria-hidden="true" />
    Open on website
    <span class="sr-only">(opens a new tab)</span>
  </a>
</template>
