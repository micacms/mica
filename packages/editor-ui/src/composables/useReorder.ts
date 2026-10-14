/**
 * Changing the order of a list, the same way in every list: the entries of a
 * collection, the rows of a repeater, the chosen entries of a relation, and the
 * files of a media field. A handle on the left moves an item with the mouse, or
 * with the keyboard (Space picks it up, the arrow keys, Home and End move it,
 * Space drops it, Escape puts it back). Two arrows on the right move it one step.
 */

import { nextTick, ref } from "vue";

import { announce } from "@/lib/announce";
import { moveItem } from "@/lib/order";

export interface ReorderOptions<T> {
  /** Names the list in the page, so that the focus can find its controls again after a move. */
  scope: () => string;
  items: () => readonly T[];
  /** Shows an order at once: while an item is picked up or dragged, and to put it back. */
  show: (next: T[]) => void;
  /** Keeps an order: when an item is dropped, or moved by an arrow. */
  commit: (next: T[], moved: T) => void | Promise<void>;
  id: (item: T) => string;
  label: (item: T) => string;
  disabled?: () => boolean;
  /** A grid of tiles moves along the reading order: left and right too. Default: a list. */
  layout?: "list" | "grid";
}

export type ReorderControl = "handle" | "up" | "down";

export function useReorder<T>(options: ReorderOptions<T>) {
  /** The item that the keyboard picked up, and the one that the mouse drags. */
  const lifted = ref<string | null>(null);
  const dragging = ref<string | null>(null);
  /** The item whose handle the pointer is on: only that row may start a drag. */
  const armed = ref<string | null>(null);
  let original: T[] = [];
  let dropped = false;

  const target = (item: T) => `${options.scope()}:${options.id(item)}`;
  const indexOf = (id: string) => options.items().findIndex((item) => options.id(item) === id);
  const find = (id: string) => options.items().find((item) => options.id(item) === id);

  async function focus(control: ReorderControl, item: T): Promise<void> {
    await nextTick();
    document.querySelector<HTMLElement>(`[data-reorder-${control}="${CSS.escape(target(item))}"]`)?.focus();
  }

  function putBack(): void {
    const id = lifted.value;
    if (id === null) return;
    options.show([...original]);
    lifted.value = null;
    const item = find(id);
    if (item) announce(`"${options.label(item)}" is back at position ${indexOf(id) + 1}.`);
  }

  /* The keyboard, on the handle. */

  const disabled = () => options.disabled?.() ?? false;

  function onKeydown(event: KeyboardEvent, item: T): void {
    if (disabled()) return;
    const id = options.id(item);
    // Only the item that was picked up moves; a key on another handle puts it back first.
    if (lifted.value !== null && lifted.value !== id) putBack();

    const items = options.items();
    const index = indexOf(id);

    if (lifted.value === null) {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      lifted.value = id;
      original = [...items];
      announce(`Picked up "${options.label(item)}", position ${index + 1} of ${items.length}. Use the arrow keys, Home or End, then Space to drop.`);
      return;
    }

    const keys: Record<string, number> = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: items.length - 1 };
    if (options.layout === "grid") Object.assign(keys, { ArrowLeft: index - 1, ArrowRight: index + 1 });
    const to = keys[event.key];
    if (to !== undefined) {
      event.preventDefault();
      if (to < 0 || to >= items.length || to === index) return;
      options.show(moveItem(items, index, to));
      announce(`Position ${to + 1} of ${items.length}.`);
      void focus("handle", item);
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      lifted.value = null;
      announce(`"${options.label(item)}" is now at position ${index + 1} of ${items.length}.`);
      void Promise.resolve(options.commit([...items], item)).then(() => focus("handle", item));
    } else if (event.key === "Escape") {
      event.preventDefault();
      putBack();
      void focus("handle", item);
    }
  }

  /** Leaving the handle puts a picked-up item back. A move blurs the handle too, and `focus` returns it first. */
  function onBlur(): void {
    window.setTimeout(() => {
      const id = lifted.value;
      if (id === null) return;
      const item = find(id);
      const active = (document.activeElement as HTMLElement | null)?.dataset["reorderHandle"];
      if (!item || active !== target(item)) putBack();
    }, 0);
  }

  /* The mouse: the handle arms its row, the row moves as it is dragged over others, and a drop keeps the order. */

  function onDragStart(event: DragEvent, item: T): void {
    if (armed.value !== options.id(item)) return;
    event.stopPropagation();
    dragging.value = options.id(item);
    original = [...options.items()];
    dropped = false;
    event.dataTransfer?.setData("text/plain", options.label(item));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(event: DragEvent, item: T): void {
    const moving = dragging.value;
    if (moving === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const over = options.id(item);
    if (over === moving) return;
    // Only past the middle of the row: rows of different heights would otherwise swap back at once.
    const from = indexOf(moving);
    const to = indexOf(over);
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const past =
      options.layout === "grid" ? event.clientX > box.left + box.width / 2 : event.clientY > box.top + box.height / 2;
    if ((from < to && !past) || (from > to && past)) return;
    options.show(moveItem(options.items(), from, to));
  }

  function onDrop(event: DragEvent): void {
    if (dragging.value === null) return;
    event.preventDefault();
    event.stopPropagation();
    dropped = true;
  }

  /** A drag that ends outside the list, or with Escape, puts the order back. */
  function onDragEnd(event: DragEvent): void {
    const id = dragging.value;
    dragging.value = null;
    armed.value = null;
    if (id === null) return;
    event.stopPropagation();
    if (!dropped || event.dataTransfer?.dropEffect === "none") {
      options.show([...original]);
      return;
    }
    const item = find(id);
    if (!item) return;
    announce(`"${options.label(item)}" is now at position ${indexOf(id) + 1} of ${options.items().length}.`);
    void options.commit([...options.items()], item);
  }

  /* The arrows. */

  function step(item: T, direction: -1 | 1): void {
    if (disabled()) return;
    const items = options.items();
    const from = indexOf(options.id(item));
    const to = from + direction;
    if (from < 0 || to < 0 || to >= items.length) return;
    const next = moveItem(items, from, to);
    options.show(next);
    announce(`"${options.label(item)}" is now at position ${to + 1} of ${items.length}.`);
    // At the end of the list its arrow is disabled: the other one takes the focus.
    const edge = (direction < 0 && to === 0) || (direction > 0 && to === items.length - 1);
    const control = edge ? (direction < 0 ? "down" : "up") : direction < 0 ? "up" : "down";
    // After the save: while it runs, the arrows are disabled and cannot take the focus.
    void Promise.resolve(options.commit(next, item)).then(() => focus(control, item));
  }

  /** The attributes and listeners of a row. */
  function row(item: T) {
    return {
      draggable: !disabled() && armed.value === options.id(item),
      onDragstart: (event: DragEvent) => onDragStart(event, item),
      onDragover: (event: DragEvent) => onDragOver(event, item),
      onDrop,
      onDragend: onDragEnd,
    };
  }

  /** The attributes and listeners of a row's handle. */
  function handle(item: T) {
    const id = options.id(item);
    return {
      "data-reorder-handle": target(item),
      "aria-pressed": lifted.value === id,
      onPointerdown: () => (armed.value = disabled() ? null : id),
      onPointerup: () => (armed.value = null),
      onKeydown: (event: KeyboardEvent) => onKeydown(event, item),
      onBlur,
    };
  }

  /** Whether an item is picked up or dragged right now. */
  const isMoving = (item: T) => lifted.value === options.id(item) || dragging.value === options.id(item);

  return { row, handle, step, target, isMoving };
}
