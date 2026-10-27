/**
 * The language that a form shows, for a site with locales. A view provides it; a localized field shows the input of
 * that language only. The choice stays when the editor opens the next entry, so a translator stays in one language.
 */

import { computed, inject, provide, ref, type ComputedRef, type InjectionKey, type Ref } from "vue";

import type { FieldMap, ObjectField } from "@micacms/core/internal";

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
    // Not a language of the site: the form cannot show it, and `focusField` must not try again.
    if (target === null || target === locale.value || !value.value.locales.list.includes(target)) return;
    locale.value = target;
    // The field of that language is on the page after the next render: `focusField` looks again then.
    event.preventDefault();
  };
  return { form: value, reveal };
}

/** Shows the forms in `locale`, such as the language of the page in the live preview. */
export function chooseFormLocale(locale: string): void {
  chosen.value = locale;
}

/** The form's language, or null outside a form with one, such as a field in a dialog: it shows each language. */
export function useFormLocale(): ComputedRef<FormLocale | null> {
  return inject(FORM_LOCALE, computed(() => null));
}

/** A localized field that shows the input of one language: the button beside its label shows the other languages. */
export interface FieldTranslations {
  /** The localized field: an object with one field for each locale. */
  field: ObjectField;
  /** Its value: one value for each locale. */
  value: Record<string, unknown>;
  locale: string;
  locales: FormLocales;
  label: string;
  /** The value cannot change. */
  locked: boolean;
  /** Puts the value of `from` into the shown language. */
  use: (from: string) => void;
}

const FIELD_TRANSLATIONS: InjectionKey<ComputedRef<FieldTranslations | null>> = Symbol("field-translations");

/** For each object field: a localized one gives its translations to the input inside, any other one null, so that they stop there. */
export function provideFieldTranslations(translations: ComputedRef<FieldTranslations | null>): void {
  provide(FIELD_TRANSLATIONS, translations);
}

/** For the label of a field's input: the translations of the localized field around it, or null. */
export function useFieldTranslations(): ComputedRef<FieldTranslations | null> {
  return inject(FIELD_TRANSLATIONS, computed(() => null));
}
