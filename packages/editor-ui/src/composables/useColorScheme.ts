/**
 * The editor's appearance: the system's light or dark mode, or a choice that
 * this browser keeps in `localStorage`. The choice sets `data-theme` on the
 * page, which sets `color-scheme`; the tokens in style.css follow it.
 */

import { ref } from "vue";

export type ColorScheme = "system" | "light" | "dark";

const KEY = "mica:appearance";

/** The browser bar's colour for each scheme: the `ground` token. */
const BAR = { light: "#f4f0e6", dark: "#121816" } as const;

function stored(): ColorScheme {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    // Storage can be off, as in some private windows: then the system decides.
    return "system";
  }
}

const scheme = ref<ColorScheme>(stored());

/** Puts a scheme on the page. Called once before the app mounts, and at each choice. */
export function applyColorScheme(value: ColorScheme = scheme.value): void {
  const root = document.documentElement;
  if (value === "system") delete root.dataset["theme"];
  else root.dataset["theme"] = value;

  // index.html gives the bar a colour for each system mode; a choice overrides both.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.dataset["system"] ??= meta.content;
    meta.content = value === "system" ? meta.dataset["system"] : BAR[value];
  }
}

export function useColorScheme() {
  function choose(value: ColorScheme): void {
    scheme.value = value;
    try {
      if (value === "system") window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, value);
    } catch {
      // Not kept: the choice holds for this page only.
    }
    applyColorScheme(value);
  }

  return { scheme, choose };
}
