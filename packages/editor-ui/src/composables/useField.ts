/**
 * Shared plumbing for every field component: a stable input id, the label to
 * show, and the server-side issue that belongs to this exact path.
 */

import { computed, type ComputedRef } from "vue";

import type { AnyField, FieldIssue } from "@micacms/core/internal";

let sequence = 0;

export interface FieldProps {
  field: AnyField;
  /** Dotted path, e.g. `seo.metaTitle` or `facts.2.label`. */
  path: string;
  /** Flat issue list for the whole form; each field picks out its own. */
  issues?: FieldIssue[];
  disabled?: boolean;
}

export interface UseField {
  inputId: string;
  label: ComputedRef<string>;
  error: ComputedRef<string | null>;
  describedBy: ComputedRef<string | undefined>;
  hintId: string;
  errorId: string;
  /**
   * The value cannot change: the field is read-only, or the whole form is.
   * Controls stay focusable then (`readonly`, `aria-readonly`), so a screen
   * reader can still read them; `disabled` would take them out of reach.
   */
  locked: ComputedRef<boolean>;
}

export function useField(props: FieldProps): UseField {
  const inputId = `field-${++sequence}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  const label = computed(() => props.field.label ?? humanise(lastSegment(props.path)));

  const error = computed(() => {
    const match = props.issues?.find((issue) => issue.path === props.path);
    return match?.message ?? null;
  });

  const describedBy = computed(() => {
    const parts = [props.field.description ? hintId : null, error.value ? errorId : null].filter(
      Boolean,
    );
    return parts.length > 0 ? parts.join(" ") : undefined;
  });

  const locked = computed(() => !!props.disabled || !!props.field.readonly);

  return { inputId, label, error, describedBy, hintId, errorId, locked };
}

function lastSegment(path: string): string {
  return path.split(".").at(-1) ?? path;
}

/** `metaTitle` → `Meta title`, used when a field declares no label. The key `id` is "ID". */
export function humanise(key: string): string {
  if (key === "id") return "ID";
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

const WIDTHS: Record<string, string> = {
  full: "col-span-12",
  half: "col-span-12 sm:col-span-6",
  third: "col-span-12 sm:col-span-4",
};

export function widthClass(field: AnyField): string {
  return WIDTHS[field.width ?? "full"] ?? WIDTHS.full!;
}
