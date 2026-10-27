<script setup lang="ts">
/**
 * The language that the form shows, in the page header of a site with locales. A pill tells how many translations
 * of a language are missing, and a red "!" that one of its fields needs attention; the words are in the tooltip.
 */

import { computed, useId } from "vue";

import type { FieldIssue, FieldMap } from "@micacms/core/internal";

import type { FormLocale } from "@/composables/useFormLocale";
import { missingTranslations, pathLocale } from "@/lib/locales";

const props = defineProps<{ form: FormLocale; fields: FieldMap; values: Record<string, unknown>; issues: FieldIssue[] }>();

const id = useId();

const options = computed(() =>
  props.form.locales.list.map((locale) => {
    const missing = missingTranslations(props.fields, props.values, locale, props.form.locales);
    const problem = props.issues.some((issue) => pathLocale(props.fields, issue.path) === locale);
    const count = missing > 0 ? `${missing} missing translation${missing === 1 ? "" : "s"}` : "";
    return { locale, missing, problem, hint: [problem ? "Needs attention" : "", count].filter(Boolean).join(" · ") };
  }),
);
</script>

<template>
  <div class="flex items-center gap-3">
    <p :id="id" class="text-xs font-medium text-muted">Language</p>
    <div role="group" :aria-labelledby="id" class="flex flex-wrap gap-1">
      <button
        v-for="option in options"
        :key="option.locale"
        type="button"
        :aria-pressed="form.locale.value === option.locale"
        class="group relative flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-ink-soft transition hover:bg-subtle aria-pressed:bg-primary aria-pressed:text-on-primary"
        @click="form.locale.value = option.locale"
      >
        <span :lang="option.locale">{{ option.locale.toUpperCase() }}</span>
        <span v-if="option.locale === form.locales.default" class="sr-only">(default language)</span>
        <span v-if="option.missing" class="count bg-glint text-on-glint" aria-hidden="true">{{ option.missing }}</span>
        <span v-if="option.problem" class="count bg-danger text-on-danger" aria-hidden="true">!</span>
        <template v-if="option.hint">
          <span class="sr-only">, {{ option.hint }}</span>
          <span class="tooltip left-1/2 -translate-x-1/2 group-hover:tooltip-shown group-focus-visible:tooltip-shown" aria-hidden="true">{{ option.hint }}</span>
        </template>
      </button>
    </div>
  </div>
</template>
