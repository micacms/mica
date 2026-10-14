/** A text field's `pattern`, compiled: it must match the whole value, and counts code points. Internal. */
export function textPattern(pattern: string): RegExp {
  return new RegExp(`^(?:${pattern})$`, "u");
}

/**
 * The first group that repeats and contains a repeat, such as `(a+)+`, or null.
 * Such a pattern can take exponential time on a short value. A `?` after the group is safe. Internal.
 */
export function nestedRepeat(pattern: string): string | null {
  // One entry per open group: where it starts, and whether it contains a quantifier.
  const groups: { start: number; repeats: boolean }[] = [{ start: 0, repeats: false }];
  const repeated = () => (groups[groups.length - 1]!.repeats = true);
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === "\\") {
      // `\p{…}`, `\u{…}` and `\k<…>` hold a brace or a bracket that is not syntax.
      const close = /[pPu]/.test(pattern[i + 1] ?? "") && pattern[i + 2] === "{" ? "}" : pattern[i + 1] === "k" ? ">" : null;
      i = close ? pattern.indexOf(close, i) : i + 1;
    } else if (char === "[") {
      for (i++; i < pattern.length && pattern[i] !== "]"; i++) if (pattern[i] === "\\") i++;
    } else if (char === "(") {
      groups.push({ start: i, repeats: false });
      // Skip `?:`, `?=`, `?!`, `?<=`, `?<!` and `?<name>`, so that the `?` is not read as a quantifier.
      if (pattern[i + 1] === "?") i = pattern[i + 2] === "<" && /[^=!]/.test(pattern[i + 3] ?? "") ? pattern.indexOf(">", i) : i + 1;
    } else if (char === ")") {
      const group = groups.pop()!;
      const next = pattern[i + 1];
      if (group.repeats && (next === "*" || next === "+" || next === "{")) {
        return pattern.slice(group.start, next === "{" ? pattern.indexOf("}", i) + 1 : i + 2);
      }
      if (group.repeats) repeated();
    } else if (char === "*" || char === "+" || char === "?" || char === "{") {
      repeated();
      if (char === "{") i = pattern.indexOf("}", i);
    }
  }
  return null;
}
