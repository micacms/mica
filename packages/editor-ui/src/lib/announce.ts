/** Page changes for assistive technology: a polite announcement, and the focus on the new page's heading. */

import { ref } from "vue";

/** The text of the polite live region in the app shell. */
export const announcement = ref("");

let headingPending = false;

/** After a move to another page. The first page load leaves the focus where the browser put it. */
export function pageChanged(): void {
  headingPending = true;
}

/** The page heading calls this when it appears. */
export function pageArrived(heading: HTMLElement, title: string): void {
  if (!headingPending) return;
  headingPending = false;
  heading.focus({ preventScroll: true });
  announce(title);
}

/** Says a short text in the polite live region. */
export function announce(text: string): void {
  // Clearing first makes a screen reader read the same text again.
  announcement.value = "";
  window.setTimeout(() => {
    announcement.value = text;
  }, 50);
}
