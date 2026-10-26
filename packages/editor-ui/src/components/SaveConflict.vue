<script setup lang="ts">
/**
 * A colleague saved while this form was open. The editor sees both versions
 * and chooses: keep theirs, or save their own over it. Nothing is merged.
 */

import type { FieldMap } from "@micacms/core/internal";

import ChangeComparison from "@/components/ChangeComparison.vue";

defineProps<{
  /** `missing`: the saved version is gone, deleted or moved to another ID. */
  state: "loading" | "loaded" | "missing";
  theirs: Record<string, unknown> | null;
  mine: Record<string, unknown>;
  fields: FieldMap;
  busy: boolean;
}>();

const emit = defineEmits<{ keep: []; take: [] }>();
</script>

<template>
  <div role="alert" class="mb-5 rounded-md border border-warning/15 bg-warning-soft p-4">
    <p class="text-sm font-medium text-warning">Somebody else saved this while you were editing</p>
    <p v-if="state === 'loading'" role="status" class="mt-1 text-xs text-muted">Loading their version…</p>
    <template v-else-if="state === 'loaded' && theirs">
      <p class="mt-1 text-xs text-muted">Your changes are not saved yet. Their saved version, then yours:</p>
      <ChangeComparison
        :comparison="{ before: theirs, after: mine }"
        :fields="fields"
        :labels="{ before: 'Their version', after: 'Your version' }"
      />
      <div class="mt-2.5 flex flex-wrap gap-2">
        <button type="button" class="btn-secondary" :disabled="busy" @click="emit('keep')">Keep mine</button>
        <button type="button" class="btn-ghost" :disabled="busy" @click="emit('take')">Use theirs</button>
      </div>
      <p class="mt-2 text-xs text-muted">"Keep mine" saves your version over theirs. Mica notes who chose it.</p>
    </template>
    <p v-else class="mt-1 text-xs text-muted">
      It was deleted, or its ID changed. Your changes are still in the form and not saved. Copy what you
      need.
    </p>
  </div>
</template>
