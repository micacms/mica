<script setup lang="ts">
/**
 * Relation field. Stores entry slugs, so a reference is readable both in the
 * JSON payload and in the diff a reviewer reads.
 */

import { computed, onMounted, ref } from "vue";

import type { RelationField } from "@micacms/model";

import FieldShell from "./FieldShell.vue";
import { api, type EntrySummary } from "@/api";
import { useField, type FieldProps } from "@/composables/useField";
import { useSchema } from "@/stores/schema";

const props = defineProps<FieldProps & { modelValue: unknown }>();
const emit = defineEmits<{ "update:modelValue": [string | string[] | null] }>();

const field = computed(() => props.field as RelationField);
const { inputId, label, error, describedBy, hintId, errorId } = useField(props);
const schema = useSchema();

const options = ref<EntrySummary[]>([]);
const loading = ref(true);

const targetLabel = computed(
  () => schema.collection(field.value.collection)?.label ?? field.value.collection,
);

onMounted(async () => {
  try {
    // Collections here are in the hundreds, so one fetch beats a search box.
    options.value = (await api.entries.list(field.value.collection)).items;
  } finally {
    loading.value = false;
  }
});

const selected = computed<string[]>(() =>
  field.value.multiple
    ? Array.isArray(props.modelValue)
      ? (props.modelValue as string[])
      : []
    : typeof props.modelValue === "string"
      ? [props.modelValue]
      : [],
);

const titleFor = (slug: string): string =>
  options.value.find((item) => item.slug === slug)?.title ?? slug;

const isMissing = (slug: string): boolean =>
  !loading.value && !options.value.some((item) => item.slug === slug);

function toggle(slug: string): void {
  const next = selected.value.includes(slug)
    ? selected.value.filter((item) => item !== slug)
    : [...selected.value, slug];
  emit("update:modelValue", next);
}
</script>

<template>
  <FieldShell
    :input-id="inputId"
    :label="label"
    :description="field.description"
    :required="field.required"
    :error="error"
    :hint-id="hintId"
    :error-id="errorId"
  >
    <p v-if="loading" class="text-sm text-muted">Loading {{ targetLabel }}…</p>

    <p v-else-if="options.length === 0" class="text-sm text-muted">
      There are no entries in {{ targetLabel }} yet.
    </p>

    <template v-else>
      <fieldset v-if="field.multiple" class="space-y-1.5" :aria-describedby="describedBy">
        <legend class="sr-only">{{ label }}</legend>
        <label
          v-for="option in options"
          :key="option.slug"
          class="flex cursor-pointer items-center gap-2.5 rounded-sm border border-line bg-raised px-3 py-2 text-sm hover:bg-canvas"
        >
          <input
            type="checkbox"
            :checked="selected.includes(option.slug)"
            :disabled="disabled || field.readonly"
            class="h-4 w-4 rounded-sm border-line text-brand focus:ring-ink/20"
            @change="toggle(option.slug)"
          />
          <span class="min-w-0 flex-1 truncate">{{ option.title }}</span>
          <span class="shrink-0 font-mono text-[11px] text-muted">{{ option.slug }}</span>
        </label>
      </fieldset>

      <select
        v-else
        :id="inputId"
        :value="selected[0] ?? ''"
        :disabled="disabled || field.readonly"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedBy"
        :class="['input', error && 'input-invalid']"
        @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value || null)"
      >
        <option value="">Not set</option>
        <option v-for="option in options" :key="option.slug" :value="option.slug">
          {{ option.title }}
        </option>
      </select>
    </template>

    <!-- A reference whose target was deleted or renamed would silently vanish
         from the frontend; say so instead. -->
    <p v-for="slug in selected.filter(isMissing)" :key="slug" class="field-error">
      "{{ titleFor(slug) }}" is no longer in {{ targetLabel }}.
    </p>
  </FieldShell>
</template>
