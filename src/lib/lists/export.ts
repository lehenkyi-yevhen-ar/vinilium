import type { StoredItemJson } from "./rules";

/**
 * Export of a user's list data. Deliberately limited to what is the USER'S OWN: release ids, which list, notes, condition and
 * dates. No title, artist, cover or any other Discogs content (that cannot be stored or handed out beyond the 6-hour rule).
 */
export const EXPORT_COLUMNS = ["discogs_release_id", "list", "notes", "condition_media", "condition_sleeve", "added_at", "updated_at"] as const;

export const exportRow = (i: StoredItemJson): Record<(typeof EXPORT_COLUMNS)[number], string | number | null> => ({
  discogs_release_id: i.releaseId,
  list: i.list,
  notes: i.notes,
  condition_media: i.conditionMedia,
  condition_sleeve: i.conditionSleeve,
  added_at: i.addedAt,
  updated_at: i.updatedAt,
});

/**
 * One CSV cell. Quotes when needed (RFC 4180), and defuses spreadsheet formulas: a cell that starts with = + - @ or a tab/CR
 * is prefixed with an apostrophe, so opening the file in Excel or Sheets cannot run something a user typed into their notes.
 */
export function csvCell(value: string | number | null): string {
  if (value === null || value === "") return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(items: StoredItemJson[]): string {
  const lines = [EXPORT_COLUMNS.join(",")];
  for (const i of items) {
    const r = exportRow(i);
    lines.push(EXPORT_COLUMNS.map((c) => csvCell(r[c])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

export function toJson(items: StoredItemJson[], exportedAt = new Date()): string {
  return JSON.stringify({ exportedAt: exportedAt.toISOString(), columns: EXPORT_COLUMNS, items: items.map(exportRow) }, null, 2) + "\n";
}
