<script setup lang="ts">
/** The micacms wordmark: Shale on light grounds, Stone when the system is dark. */
defineOptions({ inheritAttrs: false });
</script>

<template>
  <picture>
    <source srcset="/brand/micacms-wordmark-light.svg" media="(prefers-color-scheme: dark)" />
    <img src="/brand/micacms-wordmark.svg" alt="micacms" class="w-auto" v-bind="$attrs" />
  </picture>
</template>
