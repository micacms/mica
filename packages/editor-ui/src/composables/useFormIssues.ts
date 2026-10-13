/**
 * The problems of a form, checked in the browser with the model's own rules.
 * A field is checked when the editor leaves it, and the whole form before a
 * save. A problem goes away as soon as its field is correct. `required` is
 * left to Publish: a draft may be saved without it.
 */

import { ref, watch, type Ref } from "vue";

import { validateFields, type FieldIssue, type FieldMap } from "@micacms/core";

const within = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}.`);

export function useFormIssues(fields: () => FieldMap | undefined, values: Ref<Record<string, unknown>>) {
  const issues = ref<FieldIssue[]>([]);
  const left = new Set<string>();
  /** Problems from the server that the browser cannot check. They go when their field changes. */
  let fromServer: FieldIssue[] = [];

  const current = (): FieldIssue[] => {
    const map = fields();
    if (!map) return [];
    const result = validateFields(map, values.value, { enforceRequired: false });
    return result.ok ? [] : result.issues;
  };

  /** The browser's problems and the server's that the browser does not see, one per path. */
  const withServer = (browser: FieldIssue[]): FieldIssue[] => [
    ...browser,
    ...fromServer.filter((issue) => !browser.some((own) => own.path === issue.path)),
  ];

  /** Keeps the shown problems that still exist, with their current wording, and adds those of the fields left so far. */
  const refresh = (): void => {
    const now = current();
    const shown = new Set(issues.value.map((issue) => issue.path));
    issues.value = withServer(now.filter((issue) => shown.has(issue.path) || [...left].some((path) => within(issue.path, path))));
  };

  // A server problem that the browser cannot check stays until its field changes.
  let before = JSON.stringify(values.value);
  watch(
    values,
    (next) => {
      const previous = JSON.parse(before) as Record<string, unknown>;
      before = JSON.stringify(next);
      if (issues.value.length === 0) return;
      const changed = Object.keys({ ...previous, ...next }).filter(
        (key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]),
      );
      const now = current();
      fromServer = fromServer.filter((issue) => !changed.some((key) => within(issue.path, key)));
      issues.value = issues.value.flatMap((issue) => {
        if (!changed.some((key) => within(issue.path, key))) return [issue];
        const still = now.find((candidate) => candidate.path === issue.path);
        return still ? [still] : [];
      });
    },
    { deep: true },
  );

  return {
    issues,
    /** The editor left the field at `path`. */
    leave(path: string): void {
      left.add(path);
      refresh();
    },
    /** Before a save: every problem, and whether the browser finds none. The server checks its own again. */
    checkAll(): boolean {
      const browser = current();
      issues.value = withServer(browser);
      return browser.length === 0;
    },
    /** The server's answer to a save. */
    set(next: FieldIssue[]): void {
      fromServer = next;
      issues.value = next;
    },
    reset(): void {
      issues.value = [];
      fromServer = [];
      left.clear();
      before = JSON.stringify(values.value);
    },
  };
}

/** The dotted path of the field that an event happened in, from `data-field-path`. */
export function fieldPathOf(target: EventTarget | null): string | null {
  return target instanceof Element ? (target.closest("[data-field-path]")?.getAttribute("data-field-path") ?? null) : null;
}
