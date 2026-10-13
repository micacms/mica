/** A text field's `pattern`, compiled: it must match the whole value, and counts code points. Internal. */
export function textPattern(pattern: string): RegExp {
  return new RegExp(`^(?:${pattern})$`, "u");
}
