/**
 * Localized fields (docs/adr/0042-localized-fields.md). `defineSite` expands a
 * `localized` field into the object that the content stores, one field for each
 * locale, so that validation, serialization and the editor read an object.
 * The fallback is resolved only when the website reads the content.
 */

import type { AnyField, FieldMap, Localize, Site } from "./types.js";
import { isRecord } from "./walk.js";

/** Letters, digits and hyphens, such as `de`, `en-us` or `pt-BR`: a JSON key and a part of a file name. */
const LOCALE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

export interface SiteLocales {
  locales: string[];
  defaultLocale: string;
  fallback: Record<string, string>;
}

/** Why the locales of a site cannot be used, as the end of a sentence; null when they can. */
export function localesProblem(locales: unknown, defaultLocale: unknown, fallback: unknown): string | null {
  if (!Array.isArray(locales) || locales.length === 0) return "`locales` must be a list of locale codes, such as [\"de\", \"en\"]";
  const seen = new Map<string, string>();
  for (const locale of locales) {
    if (typeof locale !== "string" || !LOCALE_PATTERN.test(locale)) {
      return `the locale "${String(locale)}" must be a code of letters, digits and hyphens, such as "de" or "en-us"`;
    }
    const other = seen.get(locale.toLowerCase());
    if (other === locale) return `the locale "${locale}" is in the list twice`;
    if (other !== undefined) return `the locales "${other}" and "${locale}" differ only in case`;
    seen.set(locale.toLowerCase(), locale);
  }
  if (defaultLocale !== undefined && !locales.includes(defaultLocale)) return `the defaultLocale "${String(defaultLocale)}" is not one of the locales`;
  if (fallback === undefined) return null;
  if (!isRecord(fallback)) return "`fallback` must be an object, such as { \"de-ch\": \"de\" }";
  for (const [from, to] of Object.entries(fallback)) {
    if (!locales.includes(from) || typeof to !== "string" || !locales.includes(to)) {
      return `the fallback from "${from}" to "${String(to)}" must name two of the locales`;
    }
  }
  const map = fallback as Record<string, string>;
  for (const start of Object.keys(map)) {
    const chain = [start];
    for (let next = map[start]; next !== undefined; next = map[next]) {
      if (chain.includes(next)) return `the fallback ${[...chain, next].join(" → ")} is a circle`;
      chain.push(next);
    }
  }
  return null;
}

/** The locales of a site, or null when it has none. */
export function siteLocales(site: Pick<Site, "locales" | "defaultLocale" | "fallback">): SiteLocales | null {
  if (!site.locales || site.locales.length === 0) return null;
  return { locales: site.locales, defaultLocale: site.defaultLocale ?? site.locales[0]!, fallback: site.fallback ?? {} };
}

/** Whether a field is a localized field as the content stores it: an object with one field for each locale. */
export function isLocalizedObject(field: AnyField): boolean {
  return field.kind === "object" && field.localized !== undefined && field.localized !== false;
}

/**
 * A field's value as one value: for a localized field, the value of the first locale that has one, the default locale
 * first. For a title, a list column, a sort, or the source of an ID.
 */
export function singleValue(field: AnyField | undefined, value: unknown): unknown {
  if (!field || field.kind !== "object" || !isLocalizedObject(field) || !isRecord(value)) return value;
  return Object.keys(field.fields).map((locale) => value[locale]).find((one) => !isMissing(one)) ?? null;
}

/**
 * The fields with each `localized` field expanded into an object with one field for each locale. `required` and
 * `default` go to the default locale. An object that is expanded already stays as it is, when its fields are the
 * locales. Throws an `Error` with the reason, for `defineSite` to report.
 */
export function expandLocalized(fields: FieldMap, locales: SiteLocales | null, at: string): FieldMap {
  const result: FieldMap = {};
  for (const [key, field] of Object.entries(fields)) {
    const here = `${at}.${key}`;
    const localized = field.localized !== undefined && field.localized !== false;
    if (localized && !locales) throw new Error(`"${here}" is localized, but the site has no locales. Add \`locales\` to defineSite.`);
    if (localized && field.kind === "object") {
      const keys = Object.keys(field.fields);
      const inside = Object.values(field.fields);
      const stored = keys.length === locales!.locales.length && locales!.locales.every((locale) => keys.includes(locale));
      if (!stored || inside.some((one) => one.kind === "object" || one.kind === "repeater" || (one.localized !== undefined && one.localized !== false))) {
        throw new Error(`"${here}" is a localized object. Localize the fields inside it instead.`);
      }
      result[key] = field;
    } else if (localized && field.kind === "repeater") {
      throw new Error(`"${here}" is a localized repeater. Localize the fields of its rows instead.`);
    } else if (localized && field.kind === "id" && field.from !== undefined) {
      throw new Error(`"${here}" is a localized ID with \`from\`. A localized ID cannot follow another field: remove \`from\`.`);
    } else if (localized) {
      result[key] = expandField(key, field, locales!);
    } else if (field.kind === "object" || field.kind === "repeater") {
      result[key] = { ...field, fields: expandLocalized(field.fields, locales, here) } as AnyField;
    } else {
      result[key] = field;
    }
  }
  return result;
}

/** The options that belong to the object, and not to the field of each locale. */
const OBJECT_OPTIONS = ["label", "description", "listed", "readonly", "hidden", "group", "width", "localized"] as const;

function expandField(key: string, field: AnyField, locales: SiteLocales): AnyField {
  const value: Record<string, unknown> = { ...field };
  const object: Record<string, unknown> = { kind: "object" };
  for (const option of OBJECT_OPTIONS) {
    if (value[option] !== undefined) object[option] = value[option];
    delete value[option];
  }
  const { required, default: initial, ...each } = value;
  const name = field.label ?? humanise(key);
  // The default locale first: a title, a sort and the source of an ID take the first locale that has a value.
  const order = [locales.defaultLocale, ...locales.locales.filter((locale) => locale !== locales.defaultLocale)];
  object["fields"] = Object.fromEntries(
    order.map((locale) => {
      const own = locale === locales.defaultLocale;
      const one = { ...each, label: `${name} (${locale.toUpperCase()})` } as Record<string, unknown>;
      if (own && required !== undefined) one["required"] = required;
      if (own && initial !== undefined) one["default"] = initial;
      return [locale, one];
    }),
  );
  return object as unknown as AnyField;
}

/** A field key in words, as the editor shows a field without a label: `metaTitle` is "Meta title". */
export function humanise(key: string): string {
  if (key === "id") return "ID";
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** The locales to try for `locale`, in order: the locale, its `fallback` chain, then the default locale. */
export function fallbackChain(locales: SiteLocales, locale: string): string[] {
  const chain = [locale];
  for (let next = locales.fallback[locale]; next !== undefined && !chain.includes(next); next = locales.fallback[next]) chain.push(next);
  if (!chain.includes(locales.defaultLocale)) chain.push(locales.defaultLocale);
  return chain;
}

/**
 * The values of `data` in one locale: each localized value becomes the value of `locale`, or with a fallback, of the
 * first locale in its chain that has one. `fields` is a collection's or singleton's fields from `defineSite`.
 */
export function localize<T>(site: Pick<Site, "locales" | "defaultLocale" | "fallback">, fields: FieldMap, data: T, locale: string): Localize<T> {
  const locales = siteLocales(site);
  if (!locales || !locales.locales.includes(locale)) throw new Error(`"${locale}" is not a locale of the site.`);
  return (isRecord(data) ? localizeFields(fields, data, locales, locale) : data) as Localize<T>;
}

function localizeFields(fields: FieldMap, data: Record<string, unknown>, locales: SiteLocales, locale: string): Record<string, unknown> {
  const result: Record<string, unknown> = { ...data };
  for (const [key, field] of Object.entries(fields)) {
    const value = data[key];
    if (field.kind === "object" && isLocalizedObject(field)) {
      const values = isRecord(value) ? value : {};
      const chain = typeof field.localized === "object" && field.localized.fallback === false ? [locale] : fallbackChain(locales, locale);
      const found = chain.find((candidate) => !isMissing(values[candidate]));
      result[key] = found === undefined ? (values[locale] ?? null) : values[found];
    } else if (field.kind === "object" && isRecord(value)) {
      result[key] = localizeFields(field.fields, value, locales, locale);
    } else if (field.kind === "repeater" && Array.isArray(value)) {
      result[key] = value.map((row) => (isRecord(row) ? localizeFields(field.fields, row, locales, locale) : row));
    }
  }
  return result;
}

/** No value: null, empty text or an empty list. */
function isMissing(value: unknown): boolean {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}
