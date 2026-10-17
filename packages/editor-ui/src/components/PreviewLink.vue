<script setup lang="ts">
/** "Preview": the page in the local website's dev server, which shows the saved drafts. */

import { Eye } from "@lucide/vue";

defineProps<{ href: string }>();
</script>

<template>
  <a :href="href" target="_blank" rel="noopener noreferrer" class="btn-ghost" title="Opens the page with your saved changes, before you publish them">
    <Eye :size="15" aria-hidden="true" />
    Preview
    <span class="sr-only">(opens a new tab)</span>
  </a>
</template>
