import { artistKey } from "./normalize";
import type { ArtistGroup, SearchEntry } from "./types";

/**
 * Dedupe + group search hits by artist. Both rules are order-stable: groups and entries keep the order of
 * Discogs' own relevance ranking, so the best match stays on top.
 *
 *  - Hits sharing a master (`m:<id>`) collapse into ONE entry; a real master hit beats a release hit.
 *  - Hits with master_id = 0 stay standalone (`r:<id>`), deduped by release id only.
 */
export function dedupeEntries(entries: SearchEntry[]): SearchEntry[] {
  const byKey = new Map<string, SearchEntry>();
  for (const e of entries) {
    const prev = byKey.get(e.key);
    if (!prev) {
      byKey.set(e.key, { ...e });
      continue;
    }
    // Keep the first position (relevance order) but prefer data from the master record itself.
    const fromMaster = e.fromMaster && !prev.fromMaster;
    const merged: SearchEntry = fromMaster ? { ...e, mergedHits: prev.mergedHits } : { ...prev };
    merged.mergedHits = prev.mergedHits + e.mergedHits;
    merged.fromMaster = prev.fromMaster || e.fromMaster;
    merged.thumb = merged.thumb ?? prev.thumb ?? e.thumb;
    merged.formats = [...new Set([...prev.formats, ...e.formats])].slice(0, 6);
    merged.year = merged.year ?? prev.year ?? e.year;
    byKey.set(e.key, merged);
  }
  return [...byKey.values()];
}

export function groupByArtist(entries: SearchEntry[]): ArtistGroup[] {
  const groups = new Map<string, ArtistGroup>();
  for (const e of dedupeEntries(entries)) {
    const key = artistKey(e.artist);
    const g = groups.get(key) ?? { key, artist: e.artist, entries: [] };
    g.entries.push(e);
    groups.set(key, g);
  }
  return [...groups.values()];
}

/**
 * Append the next page ("load more") to what is already on screen, re-applying dedupe across pages so a
 * master that shows up again on page 2 is merged, not repeated. Pure, so the UI can use it as-is.
 */
export function mergeGroups(previous: ArtistGroup[], next: ArtistGroup[]): ArtistGroup[] {
  return groupByArtist([...previous, ...next].flatMap((g) => g.entries));
}
