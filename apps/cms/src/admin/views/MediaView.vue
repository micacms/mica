<script setup lang="ts">
/** Media library: upload, rename, set alt text, delete. */

import { computed, onMounted, ref, watch } from "vue";

import { api, ApiError, type MediaItem } from "@/api";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import PageHeader from "@/components/PageHeader.vue";
import { absoluteTime, formatBytes } from "@/lib/format";
import { useToast } from "@/stores/toast";

const toast = useToast();

const items = ref<MediaItem[]>([]);
const total = ref(0);
const loading = ref(true);
const uploading = ref(false);
const search = ref("");
const dragging = ref(false);
const selected = ref<MediaItem | null>(null);
const pendingDelete = ref<MediaItem | null>(null);
const deleting = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const draft = ref({ filename: "", altText: "" });
let searchTimer: ReturnType<typeof setTimeout> | undefined;

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await api.media.list({ search: search.value, limit: 200 });
    items.value = result.items;
    total.value = result.total;
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not load the media library.");
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 250);
});

watch(selected, (item) => {
  draft.value = { filename: item?.filename ?? "", altText: item?.alt ?? "" };
});

async function upload(files: FileList | File[] | null): Promise<void> {
  const list = Array.from(files ?? []);
  if (list.length === 0) return;

  uploading.value = true;
  try {
    const { items: uploaded } = await api.media.upload(list);
    toast.success(`Uploaded ${uploaded.length} file${uploaded.length === 1 ? "" : "s"}.`);
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "The upload failed.");
  } finally {
    uploading.value = false;
    if (fileInput.value) fileInput.value.value = "";
  }
}

async function saveDetails(): Promise<void> {
  if (!selected.value) return;
  try {
    await api.media.update(selected.value.id, draft.value);
    toast.success("Saved.");
    await load();
    selected.value = items.value.find((item) => item.id === selected.value?.id) ?? null;
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not save the details.");
  }
}

async function remove(): Promise<void> {
  const target = pendingDelete.value;
  if (!target) return;

  deleting.value = true;
  try {
    // The server refuses a referenced file unless forced; the dialog has
    // already told the editor what would break.
    await api.media.remove(target.id, target.inUse);
    toast.success("File deleted.");
    if (selected.value?.id === target.id) selected.value = null;
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not delete the file.");
  } finally {
    deleting.value = false;
    pendingDelete.value = null;
  }
}

const isImage = (item: MediaItem): boolean => item.mimeType.startsWith("image/");

const missingAlt = computed(() => items.value.filter((item) => isImage(item) && !item.alt).length);
</script>

<template>
  <PageHeader title="Media" :subtitle="`${total} file${total === 1 ? '' : 's'}`">
    <label class="btn-primary cursor-pointer">
      <input
        ref="fileInput"
        type="file"
        multiple
        class="sr-only"
        :disabled="uploading"
        @change="upload(($event.target as HTMLInputElement).files)"
      />
      {{ uploading ? "Uploading…" : "Upload files" }}
    </label>
  </PageHeader>

  <div
    class="mx-auto max-w-5xl px-4 py-5 sm:px-6"
    :class="dragging && 'rounded-xl outline-2 outline-dashed outline-brand'"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="
      dragging = false;
      upload($event.dataTransfer?.files ?? null);
    "
  >
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <input
        v-model="search"
        type="search"
        placeholder="Search files…"
        class="input max-w-64"
        aria-label="Search media"
      />

      <p v-if="missingAlt" class="text-xs text-muted">
        {{ missingAlt }} image{{ missingAlt === 1 ? "" : "s" }} without alt text
      </p>
    </div>

    <p v-if="loading" class="py-12 text-center text-sm text-muted">Loading…</p>

    <div v-else-if="items.length === 0" class="card px-4 py-12 text-center">
      <p class="text-sm font-medium">
        {{ search ? `Nothing matches "${search}".` : "No files yet." }}
      </p>
      <p class="mt-1 text-sm text-muted">
        Drag files anywhere on this page to upload them.
      </p>
    </div>

    <div v-else class="grid gap-5 lg:grid-cols-[1fr_20rem]">
      <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <li v-for="item in items" :key="item.id">
          <button
            type="button"
            :aria-pressed="selected?.id === item.id"
            :class="[
              'block w-full overflow-hidden rounded-lg border text-left transition',
              selected?.id === item.id
                ? 'border-brand ring-2 ring-brand/25'
                : 'border-line hover:border-brand/40',
            ]"
            @click="selected = selected?.id === item.id ? null : item"
          >
            <span class="block aspect-4/3 bg-canvas">
              <img
                v-if="isImage(item)"
                :src="item.url"
                :alt="item.alt ?? ''"
                loading="lazy"
                class="h-full w-full object-cover"
              />
              <span
                v-else
                class="flex h-full w-full items-center justify-center text-xs font-semibold uppercase text-muted"
              >
                {{ item.mimeType.split("/")[1] }}
              </span>
            </span>

            <span class="block px-2 py-1.5">
              <span class="block truncate text-xs font-medium">{{ item.filename }}</span>
              <span class="flex items-center gap-1 text-[11px] text-muted">
                {{ formatBytes(item.size) }}
                <span v-if="isImage(item) && !item.alt" class="text-warning">
                  · no alt text
                </span>
              </span>
            </span>
          </button>
        </li>
      </ul>

      <aside v-if="selected" class="card h-fit p-4 lg:sticky lg:top-5">
        <h2 class="text-sm font-semibold">File details</h2>

        <div class="mt-3 overflow-hidden rounded-lg border border-line bg-canvas">
          <img
            v-if="isImage(selected)"
            :src="selected.url"
            :alt="selected.alt ?? ''"
            class="max-h-48 w-full object-contain"
          />
          <p v-else class="p-6 text-center text-xs text-muted">
            {{ selected.mimeType }}
          </p>
        </div>

        <form class="mt-4 space-y-3" @submit.prevent="saveDetails">
          <div>
            <label for="media-filename" class="field-label">Name</label>
            <input id="media-filename" v-model="draft.filename" type="text" class="input mt-1.5" />
          </div>

          <div>
            <label for="media-alt" class="field-label">Alt text</label>
            <textarea
              id="media-alt"
              v-model="draft.altText"
              rows="2"
              class="input mt-1.5"
              placeholder="Describe the image for screen readers"
            />
            <p class="field-hint">Leave empty only if the image is purely decorative.</p>
          </div>

          <button type="submit" class="btn-primary w-full">Save details</button>
        </form>

        <dl class="mt-4 space-y-1 border-t border-line pt-3 text-xs text-muted">
          <div class="flex justify-between gap-3">
            <dt>Type</dt>
            <dd>{{ selected.mimeType }}</dd>
          </div>
          <div v-if="selected.width" class="flex justify-between gap-3">
            <dt>Dimensions</dt>
            <dd>{{ selected.width }} × {{ selected.height }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt>Size</dt>
            <dd>{{ formatBytes(selected.size) }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt>Uploaded</dt>
            <dd>{{ absoluteTime(selected.createdAt) }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt>In use</dt>
            <dd>{{ selected.inUse ? "Yes" : "No" }}</dd>
          </div>
        </dl>

        <div class="mt-3 flex gap-2">
          <a
            :href="selected.url"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-secondary flex-1"
          >
            Open
          </a>
          <button type="button" class="btn-danger flex-1" @click="pendingDelete = selected">
            Delete
          </button>
        </div>
      </aside>
    </div>
  </div>

  <ConfirmDialog
    :open="pendingDelete !== null"
    :title="`Delete “${pendingDelete?.filename}”?`"
    confirm-label="Delete"
    destructive
    :busy="deleting"
    @cancel="pendingDelete = null"
    @confirm="remove"
  >
    <p v-if="pendingDelete?.inUse" class="font-medium text-warning">
      This file is still used by published content. Deleting it will leave a gap on the website.
    </p>
    <p v-else>This cannot be undone.</p>
  </ConfirmDialog>
</template>
