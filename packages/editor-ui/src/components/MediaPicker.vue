<script setup lang="ts">
/**
 * Modal media browser: pick from the library, or upload on the spot.
 *
 * A file is identified by its path in the content repository. There is no id
 * and no registry: what the picker hands back is what the field stores and what
 * a reviewer sees in the diff.
 *
 * The search filters in the browser rather than on the server. The list is a
 * walk of the content tree — small, and already fetched whole — so a round trip
 * per keystroke would buy nothing.
 *
 * Focus is trapped while open and returned to the trigger on close, so the
 * dialog is usable from the keyboard alone.
 */

import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { X } from "@lucide/vue";

import { api, ApiError, type MediaItem } from "@/api";
import { SHARED_MEDIA, type MediaFolder } from "@/lib/media-folder";
import { useStaging } from "@/stores/staging";
import { useToast } from "@/stores/toast";

const props = withDefaults(
  defineProps<{
    open: boolean;
    accept?: "image" | "document" | "any";
    multiple?: boolean;
    /** Paths already chosen by the field, shown as ticked. */
    selected?: string[];
    /**
     * The form's own `media/` folder: uploads go there, and the picker offers its
     * files and the shared ones, never another entry's. Null while a new entry has
     * no URL. Undefined outside a form.
     */
    folder?: MediaFolder | null;
  }>(),
  { accept: "any", multiple: false, selected: () => [] },
);

const emit = defineEmits<{ close: []; choose: [MediaItem[]] }>();

const toast = useToast();

const all = ref<MediaItem[]>([]);
const loading = ref(false);
const uploading = ref(false);
const search = ref("");
const picked = ref<string[]>([]);
const dialog = ref<HTMLElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const dragging = ref(false);

let previouslyFocused: HTMLElement | null = null;

const acceptAttribute = computed(() =>
  props.accept === "image" ? "image/*" : props.accept === "document" ? "application/pdf" : undefined,
);

const items = computed(() => {
  const term = search.value.trim().toLowerCase();

  return all.value.filter((item) => {
    if (props.folder !== undefined && !item.path.startsWith(`${SHARED_MEDIA}/`) && !(props.folder && item.path.startsWith(`${props.folder.path}/`))) {
      return false;
    }
    if (props.accept === "image" && !isImage(item)) return false;
    if (props.accept === "document" && isImage(item)) return false;
    // Over the whole path, so `projects/bleicherweg` finds a file by the entry
    // it belongs to and not only by its own name.
    return !term || item.path.toLowerCase().includes(term);
  });
});

const canConfirm = computed(() => picked.value.length > 0);

const isImage = (item: MediaItem): boolean => item.mimeType.startsWith("image/");

async function load(): Promise<void> {
  loading.value = true;
  try {
    all.value = (await api.media.list()).items;
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

onBeforeUnmount(() => {
  document.body.style.overflow = "";
});

function toggle(item: MediaItem): void {
  if (!props.multiple) {
    emit("choose", [item]);
    emit("close");
    return;
  }
  picked.value = picked.value.includes(item.path)
    ? picked.value.filter((path) => path !== item.path)
    : [...picked.value, item.path];
}

function confirm(): void {
  // In the order the editor ticked them, not the order the library lists them.
  const byPath = new Map(all.value.map((item) => [item.path, item]));
  const chosen = picked.value
    .map((path) => byPath.get(path))
    .filter((item): item is MediaItem => item !== undefined);

  emit("choose", chosen);
  emit("close");
}

async function upload(files: FileList | File[] | null): Promise<void> {
  const list = Array.from(files ?? []);
  if (list.length === 0) return;

  uploading.value = true;
  try {
    const { items: uploaded } = await api.media.upload(list, {
      accept: props.accept,
      ...(props.folder ? { directory: props.folder.path, newEntry: props.folder.isNew } : {}),
    });
    // An upload is a pending change of its own, even before the form is saved.
    void useStaging().refresh();

    if (!props.multiple) {
      if (uploaded[0]) emit("choose", [uploaded[0]]);
      emit("close");
      return;
    }

    await load();
    picked.value = [...picked.value, ...uploaded.map((item) => item.path)];
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

/** The directory a file sits in, which is how an editor recognises it. */
const folderOf = (path: string): string => {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/") || "/";
};
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-6"
      @click.self="emit('close')"
      @keydown="onKeydown"
    >
      <div
        ref="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="media-picker-title"
        class="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-t-xl border border-line bg-raised shadow-2xl sm:rounded-xl"
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
            <X :size="20" aria-hidden="true" />
            <span class="sr-only">Close</span>
          </button>
        </header>

        <div
          class="min-h-0 flex-1 overflow-y-auto p-5"
          :class="dragging && 'bg-accent-soft'"
          @dragover.prevent="dragging = true"
          @dragleave.prevent="dragging = false"
          @drop.prevent="onDrop"
        >
          <p v-if="folder === null" class="mb-4 rounded-md border border-line bg-subtle px-4 py-3 text-sm text-muted">
            Give it a title or a valid URL first. Its files then get their own folder, and you can upload here.
          </p>
          <label
            v-else
            class="focus-within-ring mb-4 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line-strong bg-canvas/50 px-4 py-6 text-center transition hover:border-ink/40"
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
              {{ accept === "image" ? "Images" : accept === "document" ? "PDF documents" : "Images and documents" }}
              {{ folder ? "· stored with this content" : "· shared by all content" }}
            </span>
          </label>

          <p v-if="loading" role="status" class="py-8 text-center text-sm text-muted">Loading…</p>

          <p v-else-if="items.length === 0" class="py-8 text-center text-sm text-muted">
            {{ search ? `Nothing matches "${search}".` : "No files yet." }}
          </p>

          <ul v-else class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            <li v-for="item in items" :key="item.path">
              <button
                type="button"
                :aria-pressed="picked.includes(item.path) || selected.includes(item.path)"
                :class="[
                  'group block w-full overflow-hidden rounded-lg border text-left transition',
                  picked.includes(item.path)
                    ? 'border-accent ring-2 ring-accent/25'
                    : selected.includes(item.path)
                      ? 'border-accent/50'
                      : 'border-line hover:border-accent/40',
                ]"
                @click="toggle(item)"
              >
                <span class="block aspect-4/3 bg-canvas">
                  <img
                    v-if="isImage(item)"
                    :src="api.media.url(item.path)"
                    alt=""
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
                  <span class="block truncate text-[11px] text-muted" :title="item.path">
                    {{ folderOf(item.path) }}
                  </span>
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
