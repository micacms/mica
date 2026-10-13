/** Display formatting shared by the views. */

import type { AnyField } from "@micacms/core";

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600_000],
  ["month", 30 * 24 * 3600_000],
  ["week", 7 * 24 * 3600_000],
  ["day", 24 * 3600_000],
  ["hour", 3600_000],
  ["minute", 60_000],
];

/** "3 days ago". Falls back to an absolute date beyond a year. */
export function relativeTime(iso: string): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return "";

  const diff = timestamp - Date.now();
  const magnitude = Math.abs(diff);

  if (magnitude < 45_000) return "just now";

  for (const [unit, size] of UNITS) {
    if (magnitude >= size) return rtf.format(Math.round(diff / size), unit);
  }

  return rtf.format(Math.round(diff / 60_000), "minute");
}

/** The calendar date where the editor is, not in UTC: just after midnight in Zürich is still yesterday in UTC. */
export function localDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The value of two coordinate boxes. Both empty is null. A missing half stays
 * null, not 0, so that the form check says that it is missing. Undefined while
 * a box holds something that is not a number yet, such as "-".
 */
export function coordinatesFrom(
  latText: string,
  lngText: string,
): { lat: number | null; lng: number | null } | null | undefined {
  const lat = latText.trim();
  const lng = lngText.trim();
  if (lat === "" && lng === "") return null;
  const part = (text: string) => (text === "" ? null : Number(text));
  const value = { lat: part(lat), lng: part(lng) };
  if (Number.isNaN(value.lat) || Number.isNaN(value.lng)) return undefined;
  return value;
}

export function absoluteTime(iso: string): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    timestamp,
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** "3 d 4 h", "12 min". Coarse on purpose: this reads as an uptime, not a timer. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.floor(seconds))} s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;

  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

/** Renders a stored field value as a short string for table cells, in the field's own terms. */
export function previewValue(value: unknown, field?: AnyField): string {
  if (value === null || value === undefined || value === "") return "—";

  if (field?.kind === "date" && typeof value === "string") {
    const date = field.includeTime ? new Date(value) : new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, field.includeTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(date);
  }
  if (field?.kind === "select") {
    const labelOf = (option: unknown) => field.options.find((candidate) => candidate.value === option)?.label ?? String(option);
    return short(Array.isArray(value) ? value.map(labelOf).join(", ") : labelOf(value));
  }
  if (field?.kind === "richText" && typeof value === "string") return short(markdocText(value));
  if (field?.kind === "coordinates" && typeof value === "object") {
    const { lat, lng } = value as { lat?: unknown; lng?: unknown };
    return typeof lat === "number" && typeof lng === "number" ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : "—";
  }

  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  // `media({ alt })`: the file name says more than the alt text in a list.
  if (typeof value === "object" && !Array.isArray(value) && typeof (value as { path?: unknown }).path === "string") {
    return fileName((value as { path: string }).path);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    // Repeater rows: how many there are says more than a list of their first values.
    if (value.some((item) => item !== null && typeof item === "object" && typeof (item as { path?: unknown }).path !== "string")) {
      return String(value.length);
    }
    const parts = value.map((item) =>
      typeof item === "string" ? (field?.kind === "media" ? fileName(item) : item) : previewValue(item, field?.kind === "media" ? field : undefined),
    );
    return short(parts.join(", "));
  }
  if (typeof value === "string") return short(field?.kind === "media" ? fileName(value) : value);

  return "—";
}

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

/** The words of a Markdoc text, without its marks, links and tags. */
export function markdocText(source: string): string {
  return source
    .replace(/\{%[^%]*%\}/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|[-*+]|\d+\.|>)\s+/gm, "")
    .replace(/[*_~`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function short(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed || "—";
}
