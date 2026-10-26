/**
 * Where an upload from a form goes: the entry's or the settings page's own
 * `media/` folder. Not provided outside a form, so the Media view uploads into
 * the shared `media/` folder. Null while a new entry has no ID yet.
 */

import type { ComputedRef, InjectionKey } from "vue";

export const MEDIA_FOLDER: InjectionKey<ComputedRef<MediaFolder | null>> = Symbol("media folder");

/** `isNew`: the form is a new entry, so the server refuses a folder that a saved entry has. */
export interface MediaFolder {
  path: string;
  isNew: boolean;
}

/** The shared folder at the content root. */
export const SHARED_MEDIA = "media";
