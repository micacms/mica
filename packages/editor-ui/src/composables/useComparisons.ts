/** Before/after comparisons on the Publish page, loaded one by one and kept by key. */

import { ref } from "vue";

import type { FieldMap } from "@micacms/core/internal";

import { api, messageOf, type CompareTarget, type Comparison } from "@/api";
import { useSchema } from "@/stores/schema";

export interface LoadedComparison {
  loading: boolean;
  error: string | null;
  comparison: Comparison | null;
}

/** `origin` compares with the website's version, for a conflict; `head` with the last publication. */
export function useComparisons(against: "head" | "origin" = "head") {
  const schema = useSchema();
  const items = ref<Record<string, LoadedComparison>>({});

  async function load(key: string, target: CompareTarget): Promise<void> {
    items.value[key] = { loading: true, error: null, comparison: null };
    try {
      const comparison = await api.staging.compare(target, against);
      items.value[key] = { loading: false, error: null, comparison };
    } catch (error) {
      items.value[key] = { loading: false, error: messageOf(error, "Could not load the comparison."), comparison: null };
    }
  }

  /** Loads each one that is not loaded yet. */
  function loadMissing(list: Array<{ key: string; target?: CompareTarget | null }>): void {
    for (const { key, target } of list) {
      if (target && !items.value[key]) void load(key, target);
    }
  }

  function clear(): void {
    items.value = {};
  }

  /** The compared document's fields; null for an order comparison. */
  function fieldsFor(target: CompareTarget): FieldMap | null {
    if (target.kind === "entry") return schema.collection(target.collection)?.fields ?? null;
    if (target.kind === "singleton") return schema.singleton(target.name)?.fields ?? null;
    return null;
  }

  return { items, loadMissing, clear, fieldsFor };
}
