/** Moving to a field from a message about it: the summary, the Publish page, the live preview. */

import { nextTick } from "vue";

/**
 * Sent from a field before it takes the focus. A folded group or repeater row
 * around it opens itself (`@reveal-field`), because a hidden field cannot take
 * the focus or be scrolled to.
 */
const REVEAL_FIELD = "reveal-field";

/**
 * Sent to a field's control with the number of a block: a paragraph of a rich
 * text, or an image of a gallery. The field goes there, scrolls to it, and
 * cancels the event. It bubbles, so that a field can listen on its own element.
 */
export const FOCUS_BLOCK = "focus-block";

/** Sent from a field when its cursor or focus moves to another block, with the block's number. */
export const FIELD_BLOCK = "field-block";

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
export function focusField(path: string, root: ParentNode = document, options: { block?: number } = {}): boolean {
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
      if (options.block !== undefined && current === path) {
        const block = new CustomEvent(FOCUS_BLOCK, { detail: options.block, cancelable: true, bubbles: true });
        if (!control.dispatchEvent(block)) return;
      }
      wrapper.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
      control.focus({ preventScroll: true });
    });
    return true;
  }
  return false;
}

/**
 * For a field with a list of items, such as a gallery or the chosen entries of
 * a relation: goes to the item that `FOCUS_BLOCK` names, in the first `list`
 * element of the field. Its first control gets the focus.
 */
export function focusListItem(event: Event, list: string): void {
  const index: unknown = (event as CustomEvent).detail;
  const root = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  const item = typeof index === "number" ? root?.querySelector(list)?.children[index] : undefined;
  if (!(item instanceof HTMLElement)) return;
  event.preventDefault();
  item.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
  item.querySelector<HTMLElement>('input:not([type="hidden"]), button')?.focus({ preventScroll: true });
}

/** The focus moved to the item `index` of a list field: the live preview shows that one. */
export function reportListItem(event: FocusEvent, index: number): void {
  event.target?.dispatchEvent(new CustomEvent(FIELD_BLOCK, { bubbles: true, detail: index }));
}
