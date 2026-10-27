/**
 * The language that a form shows, for a site with locales. A view provides it; a localized field shows the input of
 * that language only. The choice stays when the editor opens the next entry, so a translator stays in one language.
 */

import { computed, inject, provide, ref, type ComputedRef, type InjectionKey, type Ref } from "vue";

import type { FieldMap } from "@micacms/core/internal";

import { pathLocale, type FormLocales } from "@/lib/locales";
import { useSchema } from "@/stores/schema";

export interface FormLocale {
  locales: FormLocales;
  /** The language that the form shows. */
  locale: Ref<string>;
}

const FORM_LOCALE: InjectionKey<ComputedRef<FormLocale | null>> = Symbol("form-locale");

/** The editor's last choice, for every form. */
const chosen = ref<string | null>(null);

/**
 * For a view with a form: the site's locales and the chosen one, also for the fields inside (`form`, null without
 * locales). `reveal` is for the form's `reveal-field`: a link to a field in another language shows that language.
 */
export function provideFormLocale(fields: () => FieldMap | undefined): { form: ComputedRef<FormLocale | null>; reveal: (event: Event) => void } {
  const schema = useSchema();
  const locale = computed<string>({
    get: () => {
      const locales = schema.site.value?.locales;
      return chosen.value && locales?.list.includes(chosen.value) ? chosen.value : (locales?.default ?? "");
    },
    set: (next) => {
      chosen.value = next;
    },
  });
  const value = computed<FormLocale | null>(() => {
    const locales = schema.site.value?.locales;
    return locales ? { locales, locale } : null;
  });
  provide(FORM_LOCALE, value);

  const reveal = (event: Event): void => {
    const path: unknown = (event as CustomEvent).detail;
    const model = fields();
    if (!value.value || !model || typeof path !== "string") return;
    const target = pathLocale(model, path);
    if (target === null || target === locale.value) return;
    locale.value = target;
    // The field of that language is on the page after the next render: `focusField` looks again then.
    event.preventDefault();
  };
  return { form: value, reveal };
}

/** The form's language, or null outside a form with one, such as a field in an overlay: it shows each language. */
export function useFormLocale(): ComputedRef<FormLocale | null> {
  return inject(FORM_LOCALE, computed(() => null));
}
