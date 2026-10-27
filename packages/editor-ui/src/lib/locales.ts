/** The languages of a form: which language a field path is in, what is missing, and what a missing value falls back to. */

import {
  addressLocale,
  fallbackChain,
  hasLocalizedFields,
  isLocalizedObject,
  missingTranslations as missingIn,
  type AnyField,
  type FieldMap,
} from "@micacms/core/internal";

export { hasLocalizedFields };

/** The site's locales, as the schema gives them: the default locale first. */
export interface FormLocales {
  list: string[];
  default: string;
  fallback: Record<string, string>;
  /** The default locale has its prefix in an address with `{locale}` too. */
  prefixDefault: boolean;
}

/** The site's locales as core's address functions read them; null for a site without locales. */
export function addressLocales(locales: FormLocales | null | undefined) {
  return locales ? { locales: locales.list, defaultLocale: locales.default, prefixDefaultLocale: locales.prefixDefault } : null;
}

/**
 * The value of `{locale}` in an address of `locale`, else of the default locale: empty for the default locale without
 * a prefix; undefined for a site without locales, whose `{locale}` can be a field.
 */
export function addressOf(locales: FormLocales | null | undefined, locale?: string | null): string | undefined {
  return addressLocale(addressLocales(locales), locale);
}

/** The locale of a dotted field path, such as `sections.0.title.en`; null for a field that is the same in each locale. */
export function pathLocale(fields: FieldMap, path: string): string | null {
  let current: FieldMap | undefined = fields;
  let localized = false;
  for (const part of path.split(".")) {
    if (localized) return part;
    const field: AnyField | undefined = current?.[part];
    // A row's index or key: its fields are the repeater's.
    if (!field) continue;
    localized = field.kind === "object" && isLocalizedObject(field);
    current = field.kind === "object" || field.kind === "repeater" ? field.fields : undefined;
  }
  return null;
}

/** How many localized values of `data` are empty in `locale`, where the default locale has one. */
export function missingTranslations(fields: FieldMap, data: Record<string, unknown>, locale: string, locales: FormLocales): number {
  return missingIn(siteOf(locales), fields, data, locale);
}

/** The locales as core's functions read them. */
function siteOf(locales: FormLocales) {
  return { locales: locales.list, defaultLocale: locales.default, fallback: locales.fallback };
}

/** What the website shows for an empty value in `locale`: the locale and the value it falls back to, or null. */
export function fallbackFor(
  field: AnyField,
  value: Record<string, unknown>,
  locale: string,
  locales: FormLocales,
): { locale: string; value: unknown } | null {
  if (typeof field.localized === "object" && field.localized.fallback === false) return null;
  const chain = fallbackChain(siteOf(locales), locale).slice(1);
  const found = chain.find((candidate) => !isEmpty(value[candidate]));
  return found === undefined ? null : { locale: found, value: value[found] };
}

/**
 * A localized value in `locale`: `translated`; `empty` in each locale; else empty here, and the website shows the
 * value of the `fallback` locale, or nothing (`missing`).
 */
export type TranslationStatus =
  | { kind: "translated" }
  | { kind: "empty" }
  | { kind: "fallback"; locale: string }
  | { kind: "missing" };

export function translationStatus(field: AnyField, value: Record<string, unknown>, locale: string, locales: FormLocales): TranslationStatus {
  if (!isEmpty(value[locale])) return { kind: "translated" };
  if (locales.list.every((other) => isEmpty(value[other]))) return { kind: "empty" };
  const fallback = fallbackFor(field, value, locale, locales);
  return fallback ? { kind: "fallback", locale: fallback.locale } : { kind: "missing" };
}

export function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}
