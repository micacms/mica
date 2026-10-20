<script setup lang="ts">
/**
 * The problems of a form, above it. Each one moves the focus to its field,
 * so a keyboard or screen-reader user gets there in one step.
 */

import type { FieldIssue } from "@micacms/core/internal";

import { ref } from "vue";

import { focusField, formRootOf } from "@/lib/focus";

defineProps<{ issues: FieldIssue[] }>();

const summary = ref<HTMLElement | null>(null);
</script>

<template>
  <div v-if="issues.length" ref="summary" role="alert" class="mb-5 rounded-md border border-danger/15 bg-danger-soft p-4">
    <p class="text-sm font-medium text-danger">
      {{ issues.length }} field{{ issues.length === 1 ? "" : "s" }} need{{ issues.length === 1 ? "s" : "" }} attention
    </p>
    <ul class="mt-1.5 space-y-0.5 text-xs text-danger">
      <li v-for="issue in issues" :key="issue.path">
        <button type="button" class="text-left underline underline-offset-2 hover:no-underline" @click="focusField(issue.path, formRootOf(summary))">
          {{ issue.message }}
        </button>
      </li>
    </ul>
  </div>
</template>
