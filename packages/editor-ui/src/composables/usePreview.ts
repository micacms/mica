/**
 * The local website's dev server, for "Preview". Asked when a form opens and
 * when the window gets the focus again, so that a dev server started in the
 * meantime shows up.
 */

import { onBeforeUnmount, onMounted, ref } from "vue";

import { api } from "@/api";

export function usePreview() {
  const address = ref<string | null>(null);

  const load = async () => {
    try {
      address.value = (await api.preview()).address;
    } catch {
      address.value = null;
    }
  };

  onMounted(() => {
    void load();
    window.addEventListener("focus", load);
  });
  onBeforeUnmount(() => window.removeEventListener("focus", load));

  return { address };
}
