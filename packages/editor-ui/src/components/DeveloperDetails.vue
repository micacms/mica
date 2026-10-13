<script setup lang="ts">
/**
 * The technical side of a message, closed by default: editors read the plain
 * words around it, and a developer opens this for the Git terms.
 */
</script>

<template>
  <details class="mt-2 text-xs text-muted">
    <summary class="cursor-pointer select-none">Details for developers</summary>
    <div class="mt-1 space-y-1"><slot /></div>
  </details>
</template>
