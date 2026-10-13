/** Moving items in a list: the selected relations, and the entries of a collection. */

/** A copy of `items` with the item at `from` moved to `to`; both are clamped to the list. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item!);
  return next;
}

/** Entries whose title or slug contains `term`, those that start with it first, without `exclude`. */
export function matchEntries<T extends { slug: string; title: string }>(
  entries: readonly T[],
  term: string,
  exclude: readonly string[] = [],
  limit = 50,
): T[] {
  const needle = term.trim().toLowerCase();
  const rank = (entry: T): number => {
    if (needle === "") return 1;
    const title = entry.title.toLowerCase();
    if (title.startsWith(needle) || entry.slug.startsWith(needle)) return 0;
    return title.includes(needle) || entry.slug.includes(needle) ? 1 : -1;
  };
  return entries
    .filter((entry) => !exclude.includes(entry.slug))
    .map((entry, index) => ({ entry, index, rank: rank(entry) }))
    .filter((item) => item.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit)
    .map((item) => item.entry);
}
