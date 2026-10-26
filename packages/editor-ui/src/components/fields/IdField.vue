<script setup lang="ts">
/**
 * ID field: the entry's ID, one part, which also names its folder.
 *
 * Follows the source field until the editor takes it over by hand, which is the
 * behaviour that keeps IDs tidy without ever surprising someone who has
 * deliberately set one. Generation happens on the server so the preview matches
 * exactly what will be stored, including de-duplication.
 */

import { computed, ref, watch } from "vue";

import type { IdField } from "@micacms/core/internal";

import FieldShell from "./FieldShell.vue";
import { api } from "@/api";
import { useField, type FieldProps } from "@/composables/useField";
import type { PageAddress } from "@/lib/pages";

const props = defineProps<
  FieldProps & {
    modelValue: unknown;
    /** Current value of the field named in `from`. */
    source?: string | null;
    /** The label of the field named in `from`, for the hint. */
    sourceLabel?: string;
    collection?: string;
    /** ID of the entry being edited, excluded from the uniqueness check. */
    exceptId?: string;
    /** The page's address around the ID, such as /hochtouren/ before it: shown as the URL under the field. */
    address?: PageAddress | null;
  }
>();

const emit = defineEmits<{ "update:modelValue": [string | null] }>();

const field = computed(() => props.field as IdField);
const { inputId, label, error, describedBy, hintId, errorId, locked: readOnly } = useField(props);

const value = computed(() => (typeof props.modelValue === "string" ? props.modelValue : ""));

/** The page's URL with this ID, for a collection with a `url`: it follows the ID and the other fields as the editor types. */
const pageUrl = computed(() => (props.address ? `${props.address.before}${value.value || "‹ID›"}${props.address.after}` : null));
const urlId = computed(() => `${inputId}-url`);
const describedByAll = computed(() => [describedBy.value, pageUrl.value ? urlId.value : ""].filter(Boolean).join(" ") || undefined);

// Once the editor edits the ID directly, stop following the title.
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
        const { id } = await api.entries.suggestId(props.collection!, source, props.exceptId);
        if (!custom.value) emit("update:modelValue", id || null);
      } catch {
        // A failed suggestion is not worth interrupting typing over; the
        // server derives the ID again on save.
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
      .suggestId(props.collection, props.source, props.exceptId)
      .then(({ id }) => emit("update:modelValue", id || null));
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
    <div class="flex items-stretch">
      <input
        :id="inputId"
        type="text"
        :value="value"
        :maxlength="field.maxLength ?? 96"
        :readonly="readOnly"
        :aria-invalid="error ? 'true' : undefined"
        :aria-describedby="describedByAll"
        :class="['input min-w-0 font-mono text-[13px]', error && 'input-invalid']"
        spellcheck="false"
        autocomplete="off"
        @input="onInput"
      />
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

    <!-- The ID is one part; the URL is the page's whole address, from the collection's url and other fields. -->
    <p v-if="pageUrl" :id="urlId" class="field-hint break-all">URL: <span class="font-mono">{{ pageUrl }}</span></p>
    <p v-if="address?.missing.length" class="field-hint">
      The page has a URL once {{ address.missing.join(" and ") }} {{ address.missing.length === 1 ? "has a value" : "have values" }}.
    </p>
    <p v-if="!custom && field.from" class="field-hint">
      Made from the {{ (sourceLabel ?? field.from).toLowerCase() }}. Change it to set your own.
    </p>
  </FieldShell>
</template>
