<script setup lang="ts">
/**
 * "Preview" on a narrow screen: the page in a new tab. On a wide screen the
 * preview is always beside the form (`PreviewPane`), so there is no link.
 */

import { onUnmounted, ref } from "vue";
import { Eye } from "@lucide/vue";

defineProps<{ href: string }>();

// The same width as the shell's sidebar: from there, the preview is beside the form.
const wide = window.matchMedia("(min-width: 1024px)");
const isWide = ref(wide.matches);
const onWidth = (event: MediaQueryListEvent) => (isWide.value = event.matches);
wide.addEventListener("change", onWidth);
onUnmounted(() => wide.removeEventListener("change", onWidth));
</script>

<template>
  <a v-if="!isWide" :href="href" target="_blank" rel="noopener noreferrer" class="btn-ghost" title="Opens the page with your saved changes, before you publish them">
    <Eye :size="15" aria-hidden="true" />
    Preview
    <span class="sr-only">(opens a new tab)</span>
  </a>
</template>
