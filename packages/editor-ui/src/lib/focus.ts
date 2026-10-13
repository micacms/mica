/** Moving to a field from a message about it: the summary, the Publish page. */

/** A smooth scroll, unless the editor asked the system for less motion. */
export function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/**
 * Scrolls to the field at a dotted path and focuses its first control. A path
 * inside a row that is not shown (`steps.3.name`) falls back to the nearest
 * field that is. Returns whether a field was found.
 */
export function focusField(path: string): boolean {
  for (let current = path; current !== ""; current = current.includes(".") ? current.slice(0, current.lastIndexOf(".")) : "") {
    const wrapper = document.querySelector<HTMLElement>(`[data-field-path="${CSS.escape(current)}"]`);
    if (!wrapper) continue;
    const control =
      wrapper.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"], button:not([disabled])',
      ) ?? wrapper;
    wrapper.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
    control.focus({ preventScroll: true });
    return true;
  }
  return false;
}
