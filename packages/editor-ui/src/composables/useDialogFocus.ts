/**
 * Focus for a modal dialog: it moves in when the dialog opens, stays inside
 * while it is open, and goes back to where it was when the dialog closes.
 */

import { nextTick, watch, type Ref } from "vue";

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]";

export function useDialogFocus(
  open: () => boolean,
  panel: Ref<HTMLElement | null>,
  initial: Ref<HTMLElement | null>,
): { trapTab: (event: KeyboardEvent) => void } {
  let previouslyFocused: HTMLElement | null = null;

  watch(open, async (isOpen) => {
    if (!isOpen) {
      previouslyFocused?.focus();
      return;
    }
    previouslyFocused = document.activeElement as HTMLElement | null;
    await nextTick();
    initial.value?.focus();
  });

  function trapTab(event: KeyboardEvent): void {
    if (event.key !== "Tab" || !panel.value) return;

    const focusable = panel.value.querySelectorAll<HTMLElement>(FOCUSABLE);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return { trapTab };
}
