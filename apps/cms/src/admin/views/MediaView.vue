<script setup lang="ts">
/**
 * Media library — a view of the files in the content repository.
 *
 * Much smaller than it was, because most of what this screen used to own has
 * moved somewhere better:
 *
 *   - Alt text is not a property of a file. The same photograph means different
 *     things in different places, so the alt text belongs to the field that
 *     uses it, next to the content it describes.
 *   - Renaming and deleting are not offered. A media file is referenced by its
 *     path; moving or removing one is a change to every entry that points at
 *     it, which is a job for a commit and a review, not for a single button
 *     that quietly leaves gaps on the website.
 *
 * What is left is the useful part: see what is there, and add to it. Files are
 * grouped by directory, because that is now meaningful — an entry's images sit
 * beside the entry.
 */

import { computed, onMounted, ref } from "vue";

import { api, ApiError, type MediaItem } from "@/api";
import PageHeader from "@/components/PageHeader.vue";
import { formatBytes } from "@/lib/format";
import { useToast } from "@/stores/toast";

const toast = useToast();

const items = ref<MediaItem[]>([]);
const loading = ref(true);
const uploading = ref(false);
const search = ref("");
const dragging = ref(false);
const selected = ref<MediaItem | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const isImage = (item: MediaItem): boolean => item.mimeType.startsWith("image/");

/** The directory a file sits in; `media` is the shared one. */
const folderOf = (path: string): string => {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/") || "/";
};

const matching = computed(() => {
  const term = search.value.trim().toLowerCase();
  return term ? items.value.filter((item) => item.path.toLowerCase().includes(term)) : items.value;
});

/** Grouped by directory, in path order — the order the repository has them. */
const folders = computed(() => {
  const groups = new Map<string, MediaItem[]>();
  for (const item of matching.value) {
    const folder = folderOf(item.path);
    const group = groups.get(folder);
    if (group) group.push(item);
    else groups.set(folder, [item]);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
});

const totalBytes = computed(() => items.value.reduce((sum, item) => sum + item.size, 0));

async function load(): Promise<void> {
  loading.value = true;
  try {
    items.value = (await api.media.list()).items;
    // The chosen file may have gone from the repository between loads.
    const stillThere = items.value.find((item) => item.path === selected.value?.path);
    selected.value = stillThere ?? null;
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not load the media library.");
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function upload(files: FileList | File[] | null): Promise<void> {
  const list = Array.from(files ?? []);
  if (list.length === 0) return;

  uploading.value = true;
  try {
    const { items: uploaded } = await api.media.upload(list);
    toast.success(`Uploaded ${uploaded.length} file${uploaded.length === 1 ? "" : "s"}.`);
    await load();
    selected.value = items.value.find((item) => item.path === uploaded[0]?.path) ?? null;
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "The upload failed.");
  } finally {
    uploading.value = false;
    if (fileInput.value) fileInput.value.value = "";
  }
}

async function copyPath(path: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(path);
    toast.success("Path copied.");
  } catch {
    // Clipboard access is denied in some browsers unless the page is focused.
    toast.error("Could not copy. Select the path and copy it by hand.");
  }
}
</script>

<template>
  <PageHeader
    title="Media"
    :subtitle="`${items.length} file${items.length === 1 ? '' : 's'} · ${formatBytes(totalBytes)}`"
  >
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
        placeholder="Search by name or folder…"
        class="input max-w-64"
        aria-label="Search media"
      />
    </div>

    <p v-if="loading" class="py-12 text-center text-sm text-muted">Loading…</p>

    <div v-else-if="matching.length === 0" class="card px-4 py-12 text-center">
      <p class="text-sm font-medium">
        {{ search ? `Nothing matches "${search}".` : "No files yet." }}
      </p>
      <p class="mt-1 text-sm text-muted">
        Drag files anywhere on this page to upload them.
      </p>
    </div>

    <div v-else class="grid gap-5 lg:grid-cols-[1fr_20rem]">
      <div class="space-y-6">
        <section v-for="[folder, files] in folders" :key="folder">
          <h2 class="mb-2 font-mono text-xs text-muted">{{ folder }}</h2>

          <ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <li v-for="item in files" :key="item.path">
              <button
                type="button"
                :aria-pressed="selected?.path === item.path"
                :class="[
                  'block w-full overflow-hidden rounded-lg border text-left transition',
                  selected?.path === item.path
                    ? 'border-brand ring-2 ring-brand/25'
                    : 'border-line hover:border-brand/40',
                ]"
                @click="selected = selected?.path === item.path ? null : item"
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
                    class="flex h-full w-full items-center justify-center text-xs font-semibold uppercase text-muted"
                  >
                    {{ item.mimeType.split("/")[1] }}
                  </span>
                </span>

                <span class="block px-2 py-1.5">
                  <span class="block truncate text-xs font-medium">{{ item.filename }}</span>
                  <span class="block text-[11px] text-muted">{{ formatBytes(item.size) }}</span>
                </span>
              </button>
            </li>
          </ul>
        </section>
      </div>

      <aside v-if="selected" class="card h-fit p-4 lg:sticky lg:top-5">
        <h2 class="text-sm font-semibold">File details</h2>

        <div class="mt-3 overflow-hidden rounded-lg border border-line bg-canvas">
          <img
            v-if="isImage(selected)"
            :src="api.media.url(selected.path)"
            alt=""
            class="max-h-48 w-full object-contain"
          />
          <p v-else class="p-6 text-center text-xs text-muted">
            {{ selected.mimeType }}
          </p>
        </div>

        <dl class="mt-4 space-y-1 text-xs text-muted">
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
        </dl>

        <!-- The path is the file's identity: it is what a field stores and what
             appears in the diff, so it is worth being able to copy. -->
        <div class="mt-3 border-t border-line pt-3">
          <p class="field-label">Path in the repository</p>
          <p class="mt-1 break-all font-mono text-[11px]">{{ selected.path }}</p>
        </div>

        <div class="mt-3 flex gap-2">
          <button type="button" class="btn-secondary flex-1" @click="copyPath(selected.path)">
            Copy path
          </button>
          <a
            :href="api.media.url(selected.path)"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-secondary flex-1"
          >
            Open
          </a>
        </div>
      </aside>
    </div>
  </div>
</template>
