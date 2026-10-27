<script setup lang="ts">
/**
 * The language that the form shows, above a form of a site with locales. Each language tells how many of its
 * translations are missing, and whether one of its fields needs attention.
 */

import { computed } from "vue";

import type { FieldIssue, FieldMap } from "@micacms/core/internal";

import type { FormLocale } from "@/composables/useFormLocale";
import { missingTranslations, pathLocale } from "@/lib/locales";

const props = defineProps<{ form: FormLocale; fields: FieldMap; values: Record<string, unknown>; issues: FieldIssue[] }>();

const options = computed(() =>
  props.form.locales.list.map((locale) => ({
    locale,
    missing: missingTranslations(props.fields, props.values, locale, props.form.locales),
    problem: props.issues.some((issue) => pathLocale(props.fields, issue.path) === locale),
  })),
);
</script>

<template>
  <div class="mb-5 flex flex-wrap items-center gap-2">
    <p id="form-language" class="text-xs font-medium text-muted">Language</p>
    <div role="group" aria-labelledby="form-language" class="flex flex-wrap rounded-full border border-line bg-surface p-0.5">
      <button
        v-for="option in options"
        :key="option.locale"
        type="button"
        :aria-pressed="form.locale.value === option.locale"
        class="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-ink-soft transition aria-pressed:bg-primary aria-pressed:text-on-primary"
        @click="form.locale.value = option.locale"
      >
        <span>{{ option.locale.toUpperCase() }}</span>
        <span v-if="option.locale === form.locales.default" class="sr-only">(default language)</span>
        <span v-if="option.missing" class="badge bg-subtle text-ink-soft">{{ option.missing }} to translate</span>
        <span v-if="option.problem" class="h-2 w-2 rounded-full bg-danger" aria-hidden="true" />
        <span v-if="option.problem" class="sr-only">needs attention</span>
      </button>
    </div>
  </div>
</template>
