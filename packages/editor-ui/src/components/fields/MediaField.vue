<script setup lang="ts">
/**
 * Media field.
 *
 * The value is a path into the content repository. The path *is* the reference:
 * the preview URL follows from it and the filename is its last segment, so
 * there is nothing to resolve and no registry to keep in step. With the `alt`
 * option, each value is `{ path, alt }`, and an alt-text input sits under the
 * preview. Several files change their order as every list does (`useReorder`),
 * in reading order: a handle, and arrows for earlier and later.
 */

import { computed, inject, ref } from "vue";
import { Plus, X } from "@lucide/vue";

import type { MediaField } from "@micacms/core/internal";

import FieldShell from "./FieldShell.vue";
import MediaPicker from "@/components/MediaPicker.vue";
import UploadList from "@/components/UploadList.vue";
import ReorderArrows from "@/components/ReorderArrows.vue";
import ReorderHandle from "@/components/ReorderHandle.vue";
import { api, type MediaItem } from "@/api";
import { useField, type FieldProps } from "@/composables/useField";
import { useReorder } from "@/composables/useReorder";
import { useUploads } from "@/composables/useUploads";
import { MEDIA_FOLDER } from "@/lib/media-folder";
import { addPaths, roomFor } from "@/lib/uploads";

interface Value {
  path: string;
  alt: string | null;
}

const props = defineProps<FieldProps & { modelValue: unknown }>();
const emit = defineEmits<{ "update:modelValue": [unknown] }>();

const field = computed(() => props.field as MediaField);
const { inputId, label, error, describedBy, hintId, errorId, locked } = useField(props);

const pickerOpen = ref(false);
/** The form's own `media/` folder; undefined outside an entry or settings form. */
const mediaFolder = inject(MEDIA_FOLDER, undefined);

/** A path saved before the field asked for alt text reads as one without it. */
function toValue(raw: unknown): Value {
  if (typeof raw === "string") return { path: raw, alt: null };
  const record = (raw ?? {}) as { path?: unknown; alt?: unknown };
  return {
    path: typeof record.path === "string" ? record.path : "",
    alt: typeof record.alt === "string" ? record.alt : null,
  };
}

const values = computed<Value[]>(() => {
  const raw = field.value.multiple
    ? Array.isArray(props.modelValue) ? props.modelValue : []
    : props.modelValue == null || props.modelValue === "" ? [] : [props.modelValue];
  return raw.map(toValue).filter((value) => value.path !== "");
});

const paths = computed(() => values.value.map((value) => value.path));

const items = computed(() =>
  values.value.map((value, index) => ({
    ...value,
    filename: value.path.split("/").pop() ?? value.path,
    url: api.media.url(value.path),
    // From the extension: the picker knows the real type, but a field rendering
    // a saved path has only the path.
    isImage: /\.(jpe?g|png|webp|avif|gif)$/i.test(value.path),
    altId: `${inputId}-alt-${index}`,
    altErrorId: `${inputId}-alt-${index}-error`,
    altError:
      props.issues?.find((issue) => issue.path === (field.value.multiple ? `${props.path}.${index}.alt` : `${props.path}.alt`))
        ?.message ?? null,
  })),
);

const atLimit = computed(
  () =>
    field.value.multiple && field.value.max !== undefined && paths.value.length >= field.value.max,
);

function update(next: Value[]): void {
  const out = field.value.alt ? next : next.map((value) => value.path);
  emit("update:modelValue", field.value.multiple ? out : (out[0] ?? null));
}

function onChoose(chosen: MediaItem[]): void {
  if (!field.value.multiple) {
    update(chosen[0] ? [{ path: chosen[0].path, alt: null }] : []);
    return;
  }

  // Skip anything already present rather than duplicating it.
  const next = [...values.value];
  for (const item of chosen) if (!paths.value.includes(item.path)) next.push({ path: item.path, alt: null });
  update(field.value.max ? next.slice(0, field.value.max) : next);
}

const uploads = useUploads();
const dragging = ref(false);
/** Said after a drop: why files were not added. */
const dropNote = ref<string | null>(null);

const canDrop = computed(() => !locked.value && !atLimit.value);

/** Files dropped on the field upload to the form's folder, and join the field in the order of the drop. */
async function onDrop(event: DragEvent): Promise<void> {
  dragging.value = false;
  dropNote.value = null;
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length === 0 || !canDrop.value) return;
  if (mediaFolder?.value === null) {
    dropNote.value = "Give it a title or a valid URL first. Its files then get their own folder, and you can upload here.";
    return;
  }
  const room = field.value.multiple ? roomFor(paths.value.length, field.value.max) : 1;
  const toSend = files.slice(0, room);
  uploads.clear();
  const folder = mediaFolder?.value;
  const uploaded = await uploads.run(toSend, {
    ...(Array.isArray(field.value.accept) ? { accept: field.value.accept.join(",") } : field.value.accept ? { accept: field.value.accept } : {}),
    ...(folder ? { directory: folder.path, newEntry: folder.isNew } : {}),
  });
  addUploaded(uploaded, files.length - toSend.length);
}

async function retry(): Promise<void> {
  addUploaded(await uploads.retry(), 0);
}

function addUploaded(uploaded: MediaItem[], notSent: number): void {
  if (!field.value.multiple) {
    if (uploaded[0]) update([{ path: uploaded[0].path, alt: null }]);
  } else if (uploaded.length > 0) {
    const { next, skipped } = addPaths(paths.value, uploaded.map((item) => item.path), field.value.max);
    const byPath = new Map(values.value.map((value) => [value.path, value]));
    update(next.map((path) => byPath.get(path) ?? { path, alt: null }));
    notSent += skipped;
  }
  if (notSent > 0) {
    dropNote.value = field.value.multiple
      ? `This field takes at most ${field.value.max} files, so ${notSent === 1 ? "one file was" : `${notSent} files were`} not added.`
      : "This field takes one file, so only the first one was added.";
  }
}

function removeAt(index: number): void {
  update(values.value.filter((_, position) => position !== index));
}

const reorder = useReorder<Value>({
  scope: () => `media-${props.path}`,
  items: () => values.value,
  show: update,
  // The form keeps the order: the next save writes it.
  commit: () => {},
  id: (value) => value.path,
  label: (value) => value.path.split("/").pop() ?? value.path,
  disabled: () => locked.value,
  layout: "grid",
});

function setAlt(index: number, event: Event): void {
  const text = (event.target as HTMLInputElement).value;
  update(values.value.map((value, position) => (position === index ? { ...value, alt: text === "" ? null : text } : value)));
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
    <div
      :aria-describedby="describedBy"
      :class="['rounded-lg', dragging && 'outline-2 outline-offset-4 outline-dashed outline-ink']"
      @dragover.prevent="dragging = canDrop"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <p v-if="field.multiple" :id="`${inputId}-order-help`" class="sr-only">
        To move a file with the keyboard, press Space on its handle, then the arrow keys, Home or End, and Space again
        to drop it. Escape puts it back. The arrows move it one step earlier or later.
      </p>
      <ul
        v-if="items.length"
        :class="[
          'mb-2 gap-2',
          field.multiple
            ? field.alt ? 'grid grid-cols-2 sm:grid-cols-3' : 'grid grid-cols-3 sm:grid-cols-5'
            : 'flex',
        ]"
      >
        <li
          v-for="(item, index) in items"
          :key="item.path"
          :class="[
            'group relative overflow-hidden rounded-lg border border-line bg-canvas',
            field.multiple ? '' : field.alt ? 'w-64' : 'w-40',
            field.multiple && reorder.isMoving(values[index]!) && 'ring-2 ring-accent',
          ]"
          v-bind="field.multiple ? reorder.row(values[index]!) : {}"
        >
          <div class="aspect-4/3">
            <img
              v-if="item.isImage"
              :src="item.url"
              alt=""
              loading="lazy"
              decoding="async"
              class="h-full w-full object-cover"
            />
            <div
              v-else
              class="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center"
            >
              <span class="text-[11px] font-semibold uppercase text-muted">
                {{ item.filename.split(".").pop() }}
              </span>
            </div>
          </div>

          <p class="truncate px-1.5 py-1 text-[11px] text-muted" :title="item.path">
            {{ item.filename }}
          </p>

          <div v-if="field.alt" class="px-1.5 pb-1.5">
            <label :for="item.altId" class="text-[11px] font-medium">
              Alt text
              <span v-if="field.alt === 'required'" class="text-danger" aria-hidden="true">*</span>
              <span v-if="field.alt === 'required'" class="sr-only">(required)</span>
            </label>
            <input
              :id="item.altId"
              type="text"
              :value="item.alt ?? ''"
              :required="field.alt === 'required'"
              :readonly="locked"
              :aria-invalid="item.altError ? 'true' : undefined"
              :aria-describedby="item.altError ? item.altErrorId : undefined"
              :class="['input mt-0.5 text-xs', item.altError && 'input-invalid']"
              autocomplete="off"
              @input="setAlt(index, $event)"
            />
            <p v-if="item.altError" :id="item.altErrorId" class="field-error">{{ item.altError }}</p>
          </div>

          <!-- Controls are always in the DOM so they are reachable by keyboard,
               and only fade in visually on hover/focus. -->
          <div
            class="absolute inset-x-0 top-0 flex items-start gap-0.5 bg-gradient-to-b from-scrim to-transparent p-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100"
          >
            <ReorderHandle
              v-if="field.multiple"
              overlay
              :label="item.filename"
              :described-by="`${inputId}-order-help`"
              :disabled="locked"
              v-bind="reorder.handle(values[index]!)"
            />
            <span class="flex-1" />
            <button
              type="button"
              class="rounded-sm bg-raised/90 px-1.5 text-xs font-semibold text-danger hover:bg-raised"
              :disabled="locked"
              @click="removeAt(index)"
            >
              <X :size="14" aria-hidden="true" />
              <span class="sr-only">Remove {{ item.filename }}</span>
            </button>
            <ReorderArrows
              v-if="field.multiple"
              overlay
              layout="grid"
              :label="item.filename"
              :target="reorder.target(values[index]!)"
              :first="index === 0"
              :last="index === items.length - 1"
              :disabled="locked"
              @move="reorder.step(values[index]!, $event)"
            />
          </div>
        </li>
      </ul>

      <button
        :id="inputId"
        type="button"
        class="btn-secondary"
        :disabled="locked || atLimit"
        @click="pickerOpen = true"
      >
        <Plus :size="16" aria-hidden="true" />
        {{ items.length && !field.multiple ? "Replace" : "Add" }}
      </button>

      <span v-if="atLimit" class="ml-2 text-xs text-muted">
        Maximum of {{ field.max }} reached.
      </span>
      <span v-else-if="!locked && !items.length" class="ml-2 text-xs text-muted">
        Or drop {{ field.multiple ? "files" : "a file" }} here.
      </span>

      <p v-if="dropNote" class="mt-2 text-xs text-muted" role="status">{{ dropNote }}</p>
      <UploadList :states="uploads.states.value" :busy="uploads.busy.value" @retry="retry" @dismiss="uploads.clear()" />
    </div>

    <MediaPicker
      :open="pickerOpen"
      :accept="field.accept ?? 'any'"
      :multiple="field.multiple"
      :selected="paths"
      :folder="mediaFolder"
      @close="pickerOpen = false"
      @choose="onChoose"
    />
  </FieldShell>
</template>
