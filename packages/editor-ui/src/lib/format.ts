/** Display formatting shared by the views. */

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

/** Renders a stored field value as a short string for table cells. */
export function previewValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.length === 0 ? "—" : `${value.length}`;
  // `media({ alt })`: the file name says more than the alt text in a list.
  if (typeof value === "object" && typeof (value as { path?: unknown }).path === "string") {
    return previewValue((value as { path: string }).path.split("/").pop());
  }

  if (typeof value === "string") {
    // Rich text arrives as HTML; show the text it contains.
    const text = value.includes("<") ? value.replace(/<[^>]*>/g, " ") : value;
    const trimmed = text.replace(/\s+/g, " ").trim();
    return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed || "—";
  }

  return "—";
}
