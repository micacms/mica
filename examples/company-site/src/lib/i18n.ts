/**
 * The languages of the website in its URLs.
 *
 * The default locale has no prefix (`/contact/`), the others have one
 * (`/de/contact/`). Each page is in `src/pages/[...locale]/`: a rest parameter
 * can be empty, so one file makes the page of each locale. The content's
 * fallback is `localize()`'s work, not Astro's, so `astro.config.mjs` sets no
 * `i18n.fallback`: each page exists in each locale.
 */

import { site } from "../mica";

/** The locales, as `defineSite` names them. */
export const LOCALES = site.locales!;

/** The URL prefix of a locale, and its `locale` parameter in `getStaticPaths`: none for the default locale. */
export const localePrefix = (locale: string): string | undefined => (locale === site.defaultLocale ? undefined : locale);

/** For `getStaticPaths`: the paths of each locale, each with its `locale` parameter. */
export async function inEachLocale<P extends { params: object }>(paths: (locale: string) => Promise<P[]>) {
  const all = await Promise.all(
    LOCALES.map(async (locale) => (await paths(locale)).map((path) => ({ ...path, params: { ...path.params, locale: localePrefix(locale) } }))),
  );
  return all.flat();
}

/** An address of this website in a locale: `/contact/` is `/de/contact/` in German. Other addresses stay as they are. */
export function localePath(href: string, locale: string | undefined): string {
  const prefix = locale && localePrefix(locale);
  if (!prefix || !href.startsWith("/") || href.startsWith("//")) return href;
  return `/${prefix}${href}`;
}

/** An address of this website without its locale prefix: `/de/contact/` is `/contact/`. */
export function withoutLocale(path: string, locale: string | undefined): string {
  const prefix = locale && localePrefix(locale);
  if (!prefix) return path;
  return path === `/${prefix}` ? "/" : path.replace(new RegExp(`^/${prefix}(?=/)`), "");
}

/** The name of a locale in its own language, such as "Deutsch (Schweiz)" for `de-ch`. */
export const localeName = (locale: string): string => new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
