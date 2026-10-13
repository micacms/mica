<script setup lang="ts">
/**
 * Media library — a view of the files in the content repository.
 *
 * See what is there, add to it, and delete what nothing uses. A delete is
 * refused while an entry or a settings page uses the file, in a field or in
 * rich text, and it waits on the Publish page like every change. Two things it
 * deliberately does not offer:
 *
 *   - **Alt text.** Not a property of a file: the same photograph means
 *     different things in different places, so it belongs to the field that
 *     uses the image, next to the content it describes.
 *   - **Rename.** A media file is referenced by its path, so moving one is a
 *     change to every entry that points at it.
 *
 * Files are grouped by directory, which is meaningful here: an entry's images
 * sit beside the entry.
 */

import { computed, onMounted, ref, watch } from "vue";

import { api, ApiError, type MediaItem, type Referrer } from "@/api";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import PageHeader from "@/components/PageHeader.vue";
import { useSchema } from "@/stores/schema";
import { formatBytes } from "@/lib/format";
import { useStaging } from "@/stores/staging";
import { useToast } from "@/stores/toast";

const toast = useToast();

const items = ref<MediaItem[]>([]);
const loading = ref(true);
const uploading = ref(false);
const search = ref("");
const dragging = ref(false);
const selected = ref<MediaItem | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const schema = useSchema();
const staging = useStaging();

/** Files ticked for a delete. */
const chosen = ref(new Set<string>());
function toggleChosen(path: string): void {
  const next = new Set(chosen.value);
  if (!next.delete(path)) next.add(path);
  chosen.value = next;
}

/** Where the selected file is used, for the details panel. */
const usedBy = ref<Referrer[] | null>(null);
/** Why the use cannot be checked, such as a collection that cannot be read. */
const usageProblem = ref<string | null>(null);
/** The selected file's dimensions: the list does not read files, so it has none. */
const dimensions = ref<{ width: number; height: number } | null>(null);

watch(selected, async (item) => {
  usedBy.value = null;
  usageProblem.value = null;
  dimensions.value = null;
  if (!item) return;
  if (isImage(item)) {
    void api.media.info(item.path).then(
      (info) => {
        if (selected.value?.path === item.path && info.width && info.height) {
          dimensions.value = { width: info.width, height: info.height };
        }
      },
      () => {},
    );
  }
  try {
    const { uses, unreadable } = await api.media.usage([item.path]);
    // A slower answer for a file selected before must not show for this one.
    if (selected.value?.path !== item.path) return;
    if (unreadable.length > 0) usageProblem.value = `Mica cannot read ${unreadable.join(", ")}.`;
    else usedBy.value = uses[item.path] ?? [];
  } catch (error) {
    if (selected.value?.path === item.path) usageProblem.value = error instanceof ApiError ? error.message : "Could not check.";
  }
});

/** Files that were never published: a delete removes them for good. */
const neverPublished = computed(
  () => new Set((staging.status.value?.changes ?? []).filter((change) => change.kind === "create").map((change) => change.path)),
);

/** Files that the last delete could not remove, with what uses them. */
const blocked = ref<Array<{ path: string; users: Referrer[] }>>([]);
const confirming = ref<string[] | null>(null);
const deleting = ref(false);

function linkTo(item: Referrer) {
  return item.kind === "entry"
    ? { name: "entry", params: { collection: item.collection, slug: item.slug } }
    : { name: "singleton", params: { name: item.name } };
}

function describe(item: Referrer): string {
  return item.kind === "entry" ? `${item.title} (${schema.collection(item.collection)?.label ?? item.collection})` : item.title;
}

/** Checks where the files are used first: a used file is named, not deleted. */
async function askDelete(paths: string[]): Promise<void> {
  blocked.value = [];
  try {
    const { uses, unreadable } = await api.media.usage(paths);
    if (unreadable.length > 0) {
      toast.error(`Mica cannot read ${unreadable.join(", ")}, so it cannot tell whether the files are used.`);
      return;
    }
    blocked.value = paths.flatMap((path) => ((uses[path] ?? []).length > 0 ? [{ path, users: uses[path]! }] : []));
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not check where the files are used.");
    return;
  }
  if (blocked.value.length === 0) confirming.value = paths;
}

async function remove(): Promise<void> {
  const paths = confirming.value;
  if (!paths) return;
  deleting.value = true;
  try {
    await api.media.remove(paths);
    toast.success(`Deleted ${paths.length} file${paths.length === 1 ? "" : "s"}.`, "They leave the website when you publish.");
    confirming.value = null;
    chosen.value = new Set();
    void staging.refresh();
    await load();
  } catch (error) {
    toast.error(error instanceof ApiError ? error.message : "Could not delete.");
  } finally {
    deleting.value = false;
  }
}

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
    void staging.refresh();
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
    <label class="btn-primary focus-within-ring cursor-pointer">
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
    :class="dragging && 'rounded-md outline-2 outline-dashed outline-ink'"
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
      <template v-if="chosen.size > 0">
        <span class="text-sm text-muted">{{ chosen.size }} selected</span>
        <button type="button" class="btn-danger" @click="askDelete([...chosen])">Delete</button>
        <button type="button" class="btn-ghost" @click="chosen = new Set()">Clear selection</button>
      </template>
    </div>

    <div v-if="blocked.length" role="alert" class="mb-3 rounded-md border border-warning/15 bg-warning-soft p-4">
      <p class="text-sm font-medium text-warning">
        Not deleted: {{ blocked.length === 1 ? "this file is" : "these files are" }} still used
      </p>
      <ul class="mt-1.5 space-y-1 text-xs">
        <li v-for="item in blocked" :key="item.path">
          <span class="font-mono">{{ item.path.split("/").at(-1) }}</span> is used by
          <template v-for="(user, index) in item.users" :key="index">
            {{ index > 0 ? ", " : "" }}<RouterLink :to="linkTo(user)" class="underline underline-offset-2">{{ describe(user) }}</RouterLink>
          </template>.
        </li>
      </ul>
      <p class="mt-1.5 text-xs text-muted">Remove the file there first, then delete it here.</p>
    </div>

    <p v-if="loading" role="status" class="py-12 text-center text-sm text-muted">Loading…</p>

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
            <li v-for="item in files" :key="item.path" class="relative">
              <input
                type="checkbox"
                class="absolute left-1.5 top-1.5 z-10 size-6 cursor-pointer"
                :checked="chosen.has(item.path)"
                :aria-label="`Select ${item.filename}`"
                @change="toggleChosen(item.path)"
              />
              <button
                type="button"
                :aria-pressed="selected?.path === item.path"
                :class="[
                  'block w-full overflow-hidden rounded-lg border text-left transition',
                  selected?.path === item.path
                    ? 'border-accent ring-2 ring-accent/25'
                    : 'border-line hover:border-accent/40',
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
          <div v-if="dimensions" class="flex justify-between gap-3">
            <dt>Dimensions</dt>
            <dd>{{ dimensions.width }} × {{ dimensions.height }}</dd>
          </div>
          <div class="flex justify-between gap-3">
            <dt>Size</dt>
            <dd>{{ formatBytes(selected.size) }}</dd>
          </div>
        </dl>

        <!-- The path is the file's identity: it is what a field stores and what
             appears in the diff, so it is worth being able to copy. -->
        <div class="mt-3 border-t border-line pt-3">
          <p class="field-label">Path</p>
          <p class="mt-1 break-all font-mono text-[11px]">{{ selected.path }}</p>
        </div>

        <div class="mt-3 border-t border-line pt-3">
          <p class="field-label">Used by</p>
          <p v-if="usageProblem" class="mt-1 text-xs text-warning">{{ usageProblem }}</p>
          <p v-else-if="usedBy === null" class="mt-1 text-xs text-muted">Checking…</p>
          <p v-else-if="usedBy.length === 0" class="mt-1 text-xs text-muted">Nothing uses this file.</p>
          <ul v-else class="mt-1 space-y-0.5 text-xs">
            <li v-for="(user, index) in usedBy" :key="index">
              <RouterLink :to="linkTo(user)" class="underline underline-offset-2">{{ describe(user) }}</RouterLink>
            </li>
          </ul>
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
        <button
          type="button"
          class="btn-danger mt-2 w-full"
          :disabled="usedBy === null || usedBy.length > 0"
          @click="askDelete([selected.path])"
        >
          Delete this file
        </button>
        <p v-if="usedBy && usedBy.length > 0" class="mt-1 text-xs text-muted">Remove it where it is used first.</p>
      </aside>
    </div>
  </div>

  <ConfirmDialog
    :open="confirming !== null"
    :title="`Delete ${confirming?.length === 1 ? 'this file' : `${confirming?.length} files`}?`"
    confirm-label="Delete"
    destructive
    :busy="deleting"
    @cancel="confirming = null"
    @confirm="remove"
  >
    <p>
      Nothing uses {{ confirming?.length === 1 ? "it" : "them" }}. {{ confirming?.length === 1 ? "It leaves" : "They leave" }}
      the website when you publish. Until then, Discard on the Publish page brings
      {{ confirming?.length === 1 ? "it" : "them" }} back.
    </p>
    <p v-if="confirming?.some((path) => neverPublished.has(path))" class="mt-2 text-warning">
      {{ confirming.filter((path) => neverPublished.has(path)).map((path) => path.split("/").at(-1)).join(", ") }}
      {{ confirming.filter((path) => neverPublished.has(path)).length === 1 ? "was" : "were" }} never published: deleting
      cannot be undone.
    </p>
  </ConfirmDialog>
</template>
