<script setup lang="ts">
/**
 * The state of an upload of several files: how far it is, and each file that
 * failed with its reason. A screen reader hears the progress, politely.
 */

import { computed } from "vue";

import type { UploadState } from "@/lib/uploads";

const props = defineProps<{ states: UploadState[]; busy: boolean }>();
const emit = defineEmits<{ retry: []; dismiss: [] }>();

const failures = computed(() => props.states.filter((state) => state.status === "failed"));
const done = computed(() => props.states.filter((state) => state.status === "done").length);
const finished = computed(() => done.value + failures.value.length);
</script>

<template>
  <div v-if="states.length > 1 || failures.length" class="mt-2 rounded-md border border-line bg-canvas px-3 py-2 text-xs">
    <p role="status" aria-live="polite" class="flex items-center gap-2">
      <span v-if="busy">Uploading {{ Math.min(finished + 1, states.length) }} of {{ states.length }}…</span>
      <span v-else-if="failures.length === 0">Uploaded {{ done }} file{{ done === 1 ? "" : "s" }}.</span>
      <span v-else>
        Uploaded {{ done }} of {{ states.length }}. {{ failures.length === 1 ? "One file" : `${failures.length} files` }} did not upload.
      </span>
      <span class="flex-1" />
      <button v-if="!busy && failures.length" type="button" class="font-medium text-accent underline underline-offset-2" @click="emit('retry')">
        Try again
      </button>
      <button v-if="!busy" type="button" class="font-medium text-muted hover:text-ink" @click="emit('dismiss')">Close</button>
    </p>
    <progress v-if="busy" class="mt-1.5 h-1 w-full" :max="states.length" :value="finished" aria-hidden="true" />
    <ul v-if="failures.length" class="mt-1.5 space-y-0.5 text-danger">
      <li v-for="failure in failures" :key="failure.name">
        <span class="font-mono">{{ failure.name }}</span>: {{ failure.message }}
      </li>
    </ul>
  </div>
</template>
