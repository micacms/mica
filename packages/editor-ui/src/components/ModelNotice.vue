<script setup lang="ts">
/**
 * Why Save and Publish are refused: the server cannot read a newer content
 * model, and a save with the old one would leave out the new fields (#297).
 * It shows nothing while the model in use is the newest.
 */
import { computed } from "vue";

import DeveloperDetails from "@/components/DeveloperDetails.vue";
import { useStaging } from "@/stores/staging";

const staging = useStaging();
const warning = computed(() => staging.status.value?.model.warning ?? null);
</script>

<template>
  <div v-if="warning" role="alert" class="rounded-md border border-warning/15 bg-warning-soft p-4">
    <p class="text-sm font-medium text-warning">Saving and publishing wait</p>
    <p class="mt-1 text-xs text-muted">
      The content model changed, and this Mica cannot read it. Mica saves and publishes again after a restart or an
      upgrade. Tell the person who runs Mica.
    </p>
    <DeveloperDetails>
      <p>{{ warning }}</p>
    </DeveloperDetails>
  </div>
</template>
