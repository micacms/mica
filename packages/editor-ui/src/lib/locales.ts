/** The languages of a form: which language a field path is in, what is missing, and what a missing value falls back to. */

import { fallbackChain, isLocalizedObject, walkFields, type AnyField, type FieldMap } from "@micacms/core/internal";

/** The site's locales, as the schema gives them: the default locale first. */
export interface FormLocales {
  list: string[];
  default: string;
  fallback: Record<string, string>;
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
  if (locale === locales.default) return 0;
  let count = 0;
  walkFields(fields, data, (field, value) => {
    if (field.kind !== "object" || !isLocalizedObject(field) || !isRecord(value)) return;
    if (!isEmpty(value[locales.default]) && isEmpty(value[locale])) count += 1;
  });
  return count;
}

/** What the website shows for an empty value in `locale`: the locale and the value it falls back to, or null. */
export function fallbackFor(
  field: AnyField,
  value: Record<string, unknown>,
  locale: string,
  locales: FormLocales,
): { locale: string; value: unknown } | null {
  if (typeof field.localized === "object" && field.localized.fallback === false) return null;
  const chain = fallbackChain({ locales: locales.list, defaultLocale: locales.default, fallback: locales.fallback }, locale).slice(1);
  const found = chain.find((candidate) => !isEmpty(value[candidate]));
  return found === undefined ? null : { locale: found, value: value[found] };
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
