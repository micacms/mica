/** Moving to a field from a message about it: the summary, the Publish page, the live preview. */

import { nextTick } from "vue";

/**
 * Sent from a field before it takes the focus. A folded group or repeater row
 * around it opens itself (`@reveal-field`), because a hidden field cannot take
 * the focus or be scrolled to.
 */
const REVEAL_FIELD = "reveal-field";

/** A smooth scroll, unless the editor asked the system for less motion. */
function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/** The element around one form (`data-document-form`): a form and its overlay can show the same field. */
export const formRootOf = (element: Element | null): ParentNode => element?.closest("[data-document-form]") ?? document;

/**
 * Scrolls to the field at a dotted path in `root` and focuses its first
 * control. A path inside a row that is not shown (`steps.3.name`) falls back
 * to the nearest field that is. Returns whether a field was found.
 */
export function focusField(path: string, root: ParentNode = document): boolean {
  for (let current = path; current !== ""; current = current.includes(".") ? current.slice(0, current.lastIndexOf(".")) : "") {
    const wrapper = root.querySelector<HTMLElement>(`[data-field-path="${CSS.escape(current)}"]`);
    if (!wrapper) continue;
    // A relation's combobox, not a button of a chosen entry: Enter there would remove or move it.
    const control =
      wrapper.querySelector<HTMLElement>('[role="combobox"]') ??
      wrapper.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"], button:not([disabled])',
      ) ??
      wrapper;
    wrapper.dispatchEvent(new CustomEvent(REVEAL_FIELD, { bubbles: true }));
    // After the opened groups are on the page.
    void nextTick(() => {
      wrapper.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
      control.focus({ preventScroll: true });
    });
    return true;
  }
  return false;
}
