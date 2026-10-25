/** How the editor names the website at the top of its menu. */

import type { SchemaSite } from "@/api";

/** The host name of an address, without "www.": null without an address that can be read. */
export function siteHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The model's label, else the published website's host name, else Mica. */
export const siteName = (site: SchemaSite | null): string => site?.label ?? siteHost(site?.url ?? null) ?? "Mica";
