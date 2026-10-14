<script setup lang="ts">
/** A dialog that asks for one value, such as a link address or a position. */

import { ref, useId } from "vue";

import { useDialogFocus } from "@/composables/useDialogFocus";

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    label: string;
    modelValue: string;
    type?: "text" | "url" | "number";
    hint?: string | null;
    error?: string | null;
    confirmLabel?: string;
    min?: number;
    max?: number;
  }>(),
  { type: "text", hint: null, error: null, confirmLabel: "Apply", min: undefined, max: undefined },
);

const emit = defineEmits<{ "update:modelValue": [string]; confirm: []; cancel: [] }>();

const id = useId();

const panel = ref<HTMLElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const { trapTab } = useDialogFocus(() => props.open, panel, input);

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") emit("cancel");
  trapTab(event);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 grid place-items-center bg-scrim p-4"
      @click.self="emit('cancel')"
      @keydown="onKeydown"
    >
      <form
        ref="panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`${id}-title`"
        class="w-full max-w-md rounded-xl border border-line bg-raised p-5 shadow-2xl"
        novalidate
        @submit.prevent="emit('confirm')"
      >
        <h2 :id="`${id}-title`" class="text-base font-semibold">{{ title }}</h2>

        <label :for="`${id}-input`" class="field-label mt-4">{{ label }}</label>
        <input
          :id="`${id}-input`"
          ref="input"
          :type="type"
          :min="min"
          :max="max"
          :value="modelValue"
          :aria-invalid="error ? 'true' : undefined"
          :aria-describedby="[hint ? `${id}-hint` : '', error ? `${id}-error` : ''].join(' ').trim() || undefined"
          :class="['input mt-1.5', error && 'input-invalid']"
          @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        />
        <p v-if="hint" :id="`${id}-hint`" class="field-hint">{{ hint }}</p>
        <p v-if="error" :id="`${id}-error`" class="field-error" role="alert">{{ error }}</p>

        <div class="mt-5 flex flex-wrap justify-end gap-2">
          <slot name="extra" />
          <button type="button" class="btn-secondary" @click="emit('cancel')">Cancel</button>
          <button type="submit" class="btn-primary">{{ confirmLabel }}</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>
