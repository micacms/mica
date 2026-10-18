/**
 * Transient notifications.
 *
 * Errors stay until dismissed — an editor who missed a failed save would
 * otherwise believe their work is stored.
 */

import { readonly, ref } from "vue";

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  detail?: string;
}

const toasts = ref<Toast[]>([]);
let nextId = 1;

function push(kind: ToastKind, message: string, detail?: string): number {
  const id = nextId++;
  toasts.value = [...toasts.value, { id, kind, message, detail }];

  if (kind !== "error") {
    setTimeout(() => dismiss(id), 4000);
  }
  return id;
}

function dismiss(id: number): void {
  toasts.value = toasts.value.filter((toast) => toast.id !== id);
}

export function useToast() {
  return {
    toasts: readonly(toasts),
    success: (message: string, detail?: string) => push("success", message, detail),
    error: (message: string, detail?: string) => push("error", message, detail),
    info: (message: string, detail?: string) => push("info", message, detail),
    dismiss,
  };
}
