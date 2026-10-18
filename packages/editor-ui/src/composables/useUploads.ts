/**
 * The uploads of one place in the editor: the picker, a media field or the
 * Media view. It keeps the state of each file and the files that failed, so
 * that "Try again" sends only those.
 */

import { computed, ref } from "vue";

import { api, messageOf, type MediaItem } from "@/api";
import { uploadEach, type UploadState } from "@/lib/uploads";
import { useStaging } from "@/stores/staging";

export interface UploadTarget {
  accept?: string;
  directory?: string;
  newEntry?: boolean;
}

export function useUploads() {
  const states = ref<UploadState[]>([]);
  const failed = ref<File[]>([]);
  const busy = ref(false);
  let target: UploadTarget = {};

  const sent = computed(() => states.value.filter((state) => state.status === "done" || state.status === "failed").length);

  async function run(files: readonly File[], to: UploadTarget = {}): Promise<MediaItem[]> {
    if (files.length === 0 || busy.value) return [];
    target = to;
    busy.value = true;
    try {
      const result = await uploadEach(
        files,
        (file) => api.media.uploadOne(file, target),
        (next) => (states.value = next),
        (error) => messageOf(error, "The upload failed."),
      );
      failed.value = result.failed;
      // An upload is a pending change of its own, even before the form is saved.
      if (result.done.length > 0) void useStaging().refresh();
      return result.done;
    } finally {
      busy.value = false;
    }
  }

  /** Sends the failed files again, to the same place. */
  const retry = (): Promise<MediaItem[]> => run(failed.value, target);

  function clear(): void {
    states.value = [];
    failed.value = [];
  }

  return { states, failed, busy, sent, run, retry, clear };
}
