/**
 * The changed blocks of a rich text, for the live preview. A module of its own:
 * the preview loads it, and Markdoc with it, only when a rich text changed.
 */

import { readMarkdoc } from "@/lib/markdoc";

/** The top-level blocks of a text as JSON, or null for a text that the editor cannot show. */
function blocksOf(source: unknown): string[] | null {
  if (typeof source !== "string") return [];
  const { unsupported, doc } = readMarkdoc(source);
  return unsupported.length > 0 ? null : (doc.content ?? []).map((node) => JSON.stringify(node));
}

/**
 * The top-level blocks of a rich text that are new or changed, by their place:
 * those not in the longest run of blocks that both versions share in order.
 * Empty when blocks were only removed, or when the editor cannot show a version.
 */
export function changedBlocks(before: unknown, after: unknown): number[] {
  const [old, now] = [blocksOf(before), blocksOf(after)];
  if (!old || !now || typeof after !== "string") return [];
  // The same blocks at the start and at the end need no table: a usual edit leaves most of them.
  let start = 0;
  while (start < old.length && start < now.length && old[start] === now[start]) start++;
  let end = 0;
  while (end < old.length - start && end < now.length - start && old[old.length - 1 - end] === now[now.length - 1 - end]) end++;
  const [a, b] = [old.slice(start, old.length - end), now.slice(start, now.length - end)];
  // shared[i][j]: the length of the longest common run of a[i..] and b[j..].
  const shared = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      shared[i]![j] = a[i] === b[j] ? shared[i + 1]![j + 1]! + 1 : Math.max(shared[i + 1]![j]!, shared[i]![j + 1]!);
    }
  }
  const changed: number[] = [];
  for (let i = 0, j = 0; j < b.length; ) {
    if (i < a.length && a[i] === b[j]) [i, j] = [i + 1, j + 1];
    else if (i < a.length && shared[i + 1]![j]! >= shared[i]![j + 1]!) i++;
    else changed.push(start + j++);
  }
  return changed;
}
