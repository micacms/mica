<script setup lang="ts">
/**
 * Modal media browser: pick from the library, or upload on the spot.
 *
 * Focus is trapped while open and returned to the trigger on close, so the
 * dialog is usable from the keyboard alone.
 */

import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

import type { MediaRef } from "@micacms/model";

import { api, ApiError, type MediaItem } from "@/api";
import { useToast } from "@/stores/toast";

const props = withDefaults(
  defineProps<{
    open: boolean;
    accept?: "image" | "document" | "any";
    multiple?: boolean;
    /** Ids already chosen by the field, shown as ticked. */
    selected?: string[];
  }>(),
  { accept: "any", multiple: false, selected: () => [] },
);

const emit = defineEmits<{ close: []; choose: [MediaRef[]] }>();

const toast = useToast();

const items = ref<MediaItem[]>([]);
const loading = ref(false);
const uploading = ref(false);
const search = ref("");
const picked = ref<string[]>([]);
const dialog = ref<HTMLElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const dragging = ref(false);

let previouslyFocused: HTMLElement | null = null;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

const acceptAttribute = computed(() =>
  props.accept === "image" ? "image/*" : props.accept === "document" ? "application/pdf" : undefined,
);

const canConfirm = computed(() => picked.value.length > 0);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await api.media.list({
      search: search.value,
      image: props.accept === "image",
      limit: 100,
    });
    items.value = result.items;
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not load the media library.");
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      document.body.style.overflow = "";
      previouslyFocused?.focus();
      return;
    }

    previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    picked.value = [];
    search.value = "";

    await load();
    await nextTick();
    dialog.value?.querySelector<HTMLElement>("input, button")?.focus();
  },
);

watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 250);
});

onBeforeUnmount(() => {
  clearTimeout(searchTimer);
  document.body.style.overflow = "";
});

function toggle(item: MediaItem): void {
  if (!props.multiple) {
    emit("choose", [item]);
    emit("close");
    return;
  }
  picked.value = picked.value.includes(item.id)
    ? picked.value.filter((id) => id !== item.id)
    : [...picked.value, item.id];
}

function confirm(): void {
  const chosen = items.value.filter((item) => picked.value.includes(item.id));
  emit("choose", chosen);
  emit("close");
}

async function upload(files: FileList | File[] | null): Promise<void> {
  const list = Array.from(files ?? []);
  if (list.length === 0) return;

  uploading.value = true;
  try {
    const { items: uploaded } = await api.media.upload(list, props.accept);

    if (!props.multiple) {
      emit("choose", uploaded.slice(0, 1));
      emit("close");
      return;
    }

    await load();
    picked.value = [...picked.value, ...uploaded.map((item) => item.id)];
    toast.success(`Uploaded ${uploaded.length} file${uploaded.length === 1 ? "" : "s"}.`);
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "The upload failed.");
  } finally {
    uploading.value = false;
    if (fileInput.value) fileInput.value.value = "";
  }
}

function onDrop(event: DragEvent): void {
  dragging.value = false;
  void upload(event.dataTransfer?.files ?? null);
}

/** Keeps Tab inside the dialog, and closes on Escape. */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    emit("close");
    return;
  }
  if (event.key !== "Tab" || !dialog.value) return;

  const focusable = dialog.value.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

const formatSize = (bytes: number): string =>
  bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6"
      @click.self="emit('close')"
      @keydown="onKeydown"
    >
      <div
        ref="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="media-picker-title"
        class="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
      >
        <header class="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <h2 id="media-picker-title" class="text-base font-semibold">Media</h2>

          <input
            v-model="search"
            type="search"
            placeholder="Search files…"
            class="input ml-auto max-w-56"
            aria-label="Search media"
          />

          <button type="button" class="btn-ghost -mr-2 px-2" @click="emit('close')">
            <svg viewBox="0 0 20 20" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.75">
              <path d="M5 5l10 10M15 5L5 15" stroke-linecap="round" />
            </svg>
            <span class="sr-only">Close</span>
          </button>
        </header>

        <div
          class="min-h-0 flex-1 overflow-y-auto p-5"
          :class="dragging && 'bg-brand-soft'"
          @dragover.prevent="dragging = true"
          @dragleave.prevent="dragging = false"
          @drop.prevent="onDrop"
        >
          <label
            class="mb-4 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line bg-canvas/50 px-4 py-6 text-center transition hover:border-brand/40"
          >
            <input
              ref="fileInput"
              type="file"
              class="sr-only"
              :accept="acceptAttribute"
              :multiple="multiple"
              :disabled="uploading"
              @change="upload(($event.target as HTMLInputElement).files)"
            />
            <span class="text-sm font-medium">
              {{ uploading ? "Uploading…" : "Drop files here, or choose from your device" }}
            </span>
            <span class="text-xs text-muted">
              {{ accept === "image" ? "Images" : accept === "document" ? "PDF documents" : "Images, PDFs and video" }}
            </span>
          </label>

          <p v-if="loading" class="py-8 text-center text-sm text-muted">Loading…</p>

          <p v-else-if="items.length === 0" class="py-8 text-center text-sm text-muted">
            {{ search ? `Nothing matches "${search}".` : "No files yet." }}
          </p>

          <ul v-else class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            <li v-for="item in items" :key="item.id">
              <button
                type="button"
                :aria-pressed="picked.includes(item.id) || selected.includes(item.id)"
                :class="[
                  'group block w-full overflow-hidden rounded-lg border text-left transition',
                  picked.includes(item.id)
                    ? 'border-brand ring-2 ring-brand/25'
                    : 'border-line hover:border-brand/40',
                ]"
                @click="toggle(item)"
              >
                <span class="block aspect-4/3 bg-canvas">
                  <img
                    v-if="item.mimeType.startsWith('image/')"
                    :src="item.url"
                    :alt="item.alt ?? ''"
                    loading="lazy"
                    class="h-full w-full object-cover"
                  />
                  <span
                    v-else
                    class="flex h-full w-full items-center justify-center text-xs font-medium uppercase text-muted"
                  >
                    {{ item.mimeType.split("/")[1] }}
                  </span>
                </span>

                <span class="block px-2 py-1.5">
                  <span class="block truncate text-xs font-medium">{{ item.filename }}</span>
                  <span class="block text-[11px] text-muted">
                    {{ item.width ? `${item.width}×${item.height} · ` : "" }}{{ formatSize(item.size) }}
                  </span>
                </span>
              </button>
            </li>
          </ul>
        </div>

        <footer
          v-if="multiple"
          class="flex items-center justify-between gap-3 border-t border-line px-5 py-3"
        >
          <span class="text-sm text-muted">
            {{ picked.length }} selected
          </span>
          <div class="flex gap-2">
            <button type="button" class="btn-secondary" @click="emit('close')">Cancel</button>
            <button type="button" class="btn-primary" :disabled="!canConfirm" @click="confirm">
              Add {{ picked.length || "" }}
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
