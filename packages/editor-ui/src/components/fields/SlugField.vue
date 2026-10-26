<script setup lang="ts">
/**
 * URL field.
 *
 * Follows the source field until the editor takes it over by hand, which is the
 * behaviour that keeps URLs tidy without ever surprising someone who has
 * deliberately set one. Generation happens on the server so the preview matches
 * exactly what will be stored, including de-duplication.
 */

import { computed, ref, watch } from "vue";

import type { SlugField } from "@micacms/core/internal";

import FieldShell from "./FieldShell.vue";
import { api } from "@/api";
import { useField, type FieldProps } from "@/composables/useField";
import type { SlugAddress } from "@/lib/pages";

const props = defineProps<
  FieldProps & {
    modelValue: unknown;
    /** Current value of the field named in `from`. */
    source?: string | null;
    /** The label of the field named in `from`, for the hint. */
    sourceLabel?: string;
    collection?: string;
    /** Slug of the entry being edited, excluded from the uniqueness check. */
    exceptSlug?: string;
    /** The page's address around the slug, such as /hochtouren/ before it. Only the slug can change here. */
    address?: SlugAddress | null;
  }
>();

const emit = defineEmits<{ "update:modelValue": [string | null] }>();

const field = computed(() => props.field as SlugField);
const { inputId, label, error, describedBy, hintId, errorId, locked: readOnly } = useField(props);

const value = computed(() => (typeof props.modelValue === "string" ? props.modelValue : ""));

const before = computed(() => props.address?.before ?? "/");
const after = computed(() => props.address?.after ?? "");
/** For a screen reader: the whole address, which the parts beside the input show. */
const addressId = computed(() => `${inputId}-address`);
const describedByAll = computed(() => [describedBy.value, props.address ? addressId.value : ""].filter(Boolean).join(" ") || undefined);

// Once the editor edits the URL directly, stop following the title.
const custom = ref(value.value !== "");
let pending: ReturnType<typeof setTimeout> | undefined;

watch(
  () => props.source,
  (source) => {
    if (custom.value || !field.value.from || !props.collection) return;
    if (!source?.trim()) {
      emit("update:modelValue", null);
      return;
    }

    clearTimeout(pending);
    pending = setTimeout(async () => {
      try {
        const { slug } = await api.entries.suggestSlug(props.collection!, source, props.exceptSlug);
        if (!custom.value) emit("update:modelValue", slug || null);
      } catch {
        // A failed suggestion is not worth interrupting typing over; the
        // server derives the slug again on save.
      }
    }, 300);
  },
);

function onInput(event: Event): void {
  custom.value = true;
  const next = (event.target as HTMLInputElement).value;
  emit("update:modelValue", next === "" ? null : next);
}

function unlock(): void {
  custom.value = false;
  emit("update:modelValue", null);
  // Re-derive immediately from the current title.
  if (props.source?.trim() && props.collection) {
    void api.entries
      .suggestSlug(props.collection, props.source, props.exceptSlug)
      .then(({ slug }) => emit("update:modelValue", slug || null));
  }
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
    <!-- The address of the page: only the slug is typed here; the parts around it come from the url and from other fields. -->
    <div class="flex items-stretch">
      <span
        class="inline-flex max-w-[55%] select-none items-center rounded-l-sm border border-r-0 border-line bg-canvas px-3 font-mono text-sm text-muted"
        :title="before"
        aria-hidden="true"
      >
        <span class="truncate">{{ before }}</span>
      </span>
      <input
        :id="inputId"
        type="text"
        :value="value"
        :maxlength="field.maxLength ?? 96"
        :readonly="readOnly"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedByAll"
        :class="['input min-w-0 rounded-l-none font-mono text-[13px]', after && 'rounded-r-none', error && 'input-invalid']"
        spellcheck="false"
        autocomplete="off"
        @input="onInput"
      />
      <span
        v-if="after"
        class="inline-flex select-none items-center rounded-r-sm border border-l-0 border-line bg-canvas px-3 font-mono text-sm text-muted"
        aria-hidden="true"
      >
        {{ after }}
      </span>
      <button
        v-if="custom && field.from"
        type="button"
        class="btn-ghost ml-2 shrink-0 whitespace-nowrap"
        :disabled="readOnly"
        @click="unlock"
      >
        Reset
      </button>
    </div>

    <p v-if="address" :id="addressId" class="sr-only">The page: {{ before }}{{ value }}{{ after }}</p>
    <p v-if="address?.missing.length" class="field-hint">
      The page has an address once {{ address.missing.join(" and ") }} {{ address.missing.length === 1 ? "has a value" : "have values" }}.
    </p>
    <p v-if="!custom && field.from" class="field-hint">
      Made from the {{ (sourceLabel ?? field.from).toLowerCase() }}. Change it to set your own.
    </p>
  </FieldShell>
</template>
