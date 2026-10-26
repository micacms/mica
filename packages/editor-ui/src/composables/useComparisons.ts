/**
 * Before/after comparisons on the Publish page, kept by key. A comparison loads
 * when its row comes near the screen (`observe`), together with the others of
 * the moment: one request compares up to 25 documents, and at most two
 * requests run at once. So a change set of thousands of entries loads only
 * what the editor scrolls to.
 */

import { onScopeDispose, ref } from "vue";

import type { FieldMap } from "@micacms/core/internal";

import { api, messageOf, type CompareTarget, type Comparison } from "@/api";
import { useSchema } from "@/stores/schema";

export interface LoadedComparison {
  loading: boolean;
  error: string | null;
  comparison: Comparison | null;
}

/** As many as the server compares in one request (`COMPARE_BATCH` in the runtime). */
const BATCH = 25;
const PARALLEL = 2;

/** `origin` compares with the website's version, for a conflict; `head` with the last publication. */
export function useComparisons(against: "head" | "origin" = "head") {
  const schema = useSchema();
  const items = ref<Record<string, LoadedComparison>>({});

  /* Loading in batches. */

  const queue: Array<{ key: string; target: CompareTarget }> = [];
  let running = 0;
  /** Changes with each `clear`, so that an answer for the change set before is dropped. */
  let generation = 0;

  function load(key: string, target: CompareTarget): void {
    if (items.value[key]) return;
    items.value[key] = { loading: true, error: null, comparison: null };
    queue.push({ key, target });
    // The rows of one scroll arrive in the same task: wait for all of them.
    if (queue.length === 1) queueMicrotask(next);
  }

  function next(): void {
    while (running < PARALLEL && queue.length > 0) void send(queue.splice(0, BATCH));
  }

  async function send(batch: Array<{ key: string; target: CompareTarget }>): Promise<void> {
    const sent = generation;
    running++;
    try {
      const comparisons = await api.staging.compareMany(
        batch.map((item) => item.target),
        against,
      );
      if (sent !== generation) return;
      // Each document succeeds or fails alone: one that cannot be read blocks only its own row.
      batch.forEach(({ key }, index) => {
        const result = comparisons[index];
        items.value[key] =
          result && "comparison" in result
            ? { loading: false, error: null, comparison: result.comparison }
            : { loading: false, error: result?.error ?? "Could not load the comparison.", comparison: null };
      });
    } catch (error) {
      if (sent !== generation) return;
      const message = messageOf(error, "Could not load the comparison.");
      for (const { key } of batch) items.value[key] = { loading: false, error: message, comparison: null };
    } finally {
      running--;
      next();
    }
  }

  /** Loads each one that is not loaded yet, for a short list such as the conflicts. */
  function loadMissing(list: Array<{ key: string; target?: CompareTarget | null }>): void {
    for (const { key, target } of list) if (target) load(key, target);
  }

  /* Loading when a row comes near the screen. */

  const watched = new Map<Element, { key: string; target: CompareTarget }>();
  /** One function ref for each row, so that a new render of the page does not observe its rows again. */
  const refs = new Map<string, (element: unknown) => void>();
  const observer =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const row = watched.get(entry.target);
              if (entry.isIntersecting && row) load(row.key, row.target);
            }
          },
          { rootMargin: "600px 0px" },
        );
  onScopeDispose(() => observer?.disconnect());

  function forget(element: Element): void {
    observer?.unobserve(element);
    watched.delete(element);
  }

  /** A function ref for the element of a row: its comparison loads when the element comes near the screen. */
  function observe(key: string, target: CompareTarget): (element: unknown) => void {
    let ref = refs.get(key);
    if (ref) return ref;
    let current: Element | null = null;
    ref = (element: unknown) => {
      if (current && current !== element) forget(current);
      current = element instanceof Element ? element : null;
      if (!current) return;
      if (!observer) return load(key, target);
      watched.set(current, { key, target });
      observer.observe(current);
    };
    refs.set(key, ref);
    return ref;
  }

  function clear(): void {
    generation++;
    queue.length = 0;
    items.value = {};
    // Observe again: the observer reports each row as it is now, so that the rows on the screen load again.
    for (const element of [...watched.keys()]) {
      observer?.unobserve(element);
      if (element.isConnected) observer?.observe(element);
      else watched.delete(element);
    }
  }

  /** The compared document's fields; null for an order comparison. */
  function fieldsFor(target: CompareTarget): FieldMap | null {
    if (target.kind === "entry") return schema.collection(target.collection)?.fields ?? null;
    if (target.kind === "singleton") return schema.singleton(target.name)?.fields ?? null;
    return null;
  }

  return { items, loadMissing, observe, clear, fieldsFor };
}
