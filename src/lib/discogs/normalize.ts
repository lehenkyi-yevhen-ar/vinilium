import type { ReleaseDetail, SearchEntry, SearchMode, TrackItem, VersionSummary } from "./types";

/**
 * Raw Discogs JSON -> our shapes. This is a WHITELIST: only the fields copied below survive, so price and
 * marketplace data (`lowest_price`, `num_for_sale`, `price`, `blocked_from_sale`, community stats, ...) are
 * dropped before anything is cached or returned.
 */

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strs = (v: unknown, max = 12): string[] =>
  Array.isArray(v) ? v.map(str).filter((s): s is string => s !== null).slice(0, max) : [];
const int = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number.parseInt(v, 10) : typeof v === "number" ? Math.trunc(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const year = (v: unknown): number | null => {
  const n = int(v);
  return n !== null && n >= 1000 && n <= 3000 ? n : null; // Discogs uses 0 for "unknown"
};
const dedupe = (a: string[]) => [...new Set(a)];

/** Turns an upstream image URL into a same-origin proxy URL, or null if it must not be used. */
export type ImageMapper = (upstreamUrl: string | null | undefined) => string | null;

/**
 * Link to the matching discogs.com page. Search results give a path ("/release/1-Name"), release payloads give a
 * full URL; both are accepted, anything else falls back to the canonical "/<type>/<id>".
 */
export function discogsUrlFor(type: "release" | "master" | "artist", id: number, uri?: unknown): string {
  let path = `/${type}/${id}`;
  if (typeof uri === "string") {
    let candidate: string | null = null;
    if (uri.startsWith("/")) candidate = uri;
    else {
      try {
        const u = new URL(uri);
        if (u.protocol === "https:" && (u.hostname === "www.discogs.com" || u.hostname === "discogs.com")) candidate = u.pathname;
      } catch {
        /* not a URL */
      }
    }
    if (candidate && /^\/[A-Za-z0-9._~%/-]+$/.test(candidate)) path = candidate;
  }
  return `https://www.discogs.com${path}`;
}

/** "Artist - Title" (Discogs search `title`) -> parts. Splits on the FIRST " - ". */
export function splitArtistTitle(combined: string): { artist: string | null; title: string } {
  const i = combined.indexOf(" - ");
  if (i <= 0) return { artist: null, title: combined };
  return { artist: combined.slice(0, i).trim() || null, title: combined.slice(i + 3).trim() || combined };
}

export function artistKey(artist: string | null): string {
  if (!artist) return "";
  return artist
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** One raw search hit -> a (not yet deduped) entry, or null if it is unusable. */
export function normalizeSearchHit(raw: unknown, image: ImageMapper): SearchEntry | null {
  if (!isObj(raw)) return null;
  const id = int(raw.id);
  const type = raw.type === "master" || raw.type === "release" ? raw.type : null;
  if (id === null || id <= 0 || !type) return null;

  const { artist, title } = splitArtistTitle(str(raw.title) ?? "");
  if (!title) return null;

  // Releases that belong to a master collapse into the master (key m:<id>); master_id = 0 means standalone.
  const masterId = type === "master" ? id : (int(raw.master_id) ?? 0);
  const asMaster = masterId > 0;

  return {
    key: asMaster ? `m:${masterId}` : `r:${id}`,
    kind: asMaster ? "master" : "release",
    id: asMaster ? masterId : id,
    artist,
    title,
    year: year(raw.year),
    thumb: image(str(raw.thumb) ?? str(raw.cover_image)),
    formats: dedupe(strs(raw.format, 6)),
    country: str(raw.country),
    discogsUrl: asMaster ? discogsUrlFor("master", masterId, type === "master" ? raw.uri : undefined) : discogsUrlFor("release", id, raw.uri),
    mergedHits: 1,
    fromMaster: type === "master",
  };
}

/** Maps a /database/search response. Returns raw hits, pagination and the unusable-hit count. */
export function normalizeSearchResponse(raw: unknown, image: ImageMapper) {
  const o = isObj(raw) ? raw : {};
  const pg = isObj(o.pagination) ? o.pagination : {};
  const results = Array.isArray(o.results) ? o.results : [];
  const entries: SearchEntry[] = [];
  let dropped = 0;
  for (const r of results) {
    const e = normalizeSearchHit(r, image);
    if (e) entries.push(e);
    else dropped++;
  }
  return {
    entries,
    dropped,
    page: Math.max(1, int(pg.page) ?? 1),
    pages: Math.max(1, int(pg.pages) ?? 1),
    perPage: Math.max(1, int(pg.per_page) ?? 50),
    totalItems: Math.max(0, int(pg.items) ?? entries.length),
  };
}

function joinArtists(artists: { name: string; join: string | null }[]): string | null {
  if (!artists.length) return null;
  return artists
    .map((a, i) => (i < artists.length - 1 ? `${a.name}${a.join ? ` ${a.join} ` : ", "}` : a.name))
    .join("")
    .replace(/\s+,/g, ",")
    .trim();
}

export function normalizeVersion(raw: unknown, image: ImageMapper): VersionSummary | null {
  if (!isObj(raw)) return null;
  const id = int(raw.id);
  const title = str(raw.title);
  if (id === null || id <= 0 || !title) return null;
  const formats = dedupe([
    ...(str(raw.format)?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
    ...strs(raw.major_formats, 4),
  ]).slice(0, 8);
  return {
    id,
    title,
    label: str(raw.label),
    catno: str(raw.catno),
    country: str(raw.country),
    released: str(raw.released),
    formats,
    thumb: image(str(raw.thumb)),
    discogsUrl: discogsUrlFor("release", id),
  };
}

export function normalizeVersionsResponse(raw: unknown, image: ImageMapper) {
  const o = isObj(raw) ? raw : {};
  const pg = isObj(o.pagination) ? o.pagination : {};
  const seen = new Set<number>();
  const versions: VersionSummary[] = [];
  for (const v of Array.isArray(o.versions) ? o.versions : []) {
    const n = normalizeVersion(v, image);
    if (n && !seen.has(n.id)) {
      seen.add(n.id);
      versions.push(n);
    }
  }
  return {
    versions,
    page: Math.max(1, int(pg.page) ?? 1),
    pages: Math.max(1, int(pg.pages) ?? 1),
    perPage: Math.max(1, int(pg.per_page) ?? 50),
    totalItems: Math.max(0, int(pg.items) ?? versions.length),
  };
}

const IDENTIFIER_TYPES = new Set(["barcode", "matrix / runout", "runout", "matrix", "label code", "rights society"]);

export function normalizeRelease(raw: unknown, image: ImageMapper): ReleaseDetail | null {
  if (!isObj(raw)) return null;
  const id = int(raw.id);
  const title = str(raw.title);
  if (id === null || id <= 0 || !title) return null;

  const artistsRaw = (Array.isArray(raw.artists) ? raw.artists : []).filter(isObj);
  const artistParts = artistsRaw
    .map((a) => ({ id: int(a.id), name: str(a.anv) ?? str(a.name), join: str(a.join) }))
    .filter((a): a is { id: number | null; name: string; join: string | null } => a.name !== null);

  const images = (Array.isArray(raw.images) ? raw.images : []).filter(isObj);
  const primary = images.find((i) => i.type === "primary") ?? images[0];

  const tracklist: TrackItem[] = (Array.isArray(raw.tracklist) ? raw.tracklist : [])
    .filter(isObj)
    .map((t) => ({
      position: str(t.position) ?? "",
      title: str(t.title) ?? "",
      duration: str(t.duration),
      type: str(t.type_) ?? "track",
    }))
    .filter((t) => t.title || t.type === "heading")
    .slice(0, 200);

  const masterId = int(raw.master_id);
  return {
    id,
    masterId: masterId && masterId > 0 ? masterId : null,
    title,
    artist: joinArtists(artistParts),
    artists: artistParts.map(({ id: aid, name }) => ({ id: aid, name })),
    year: year(raw.year),
    released: str(raw.released),
    country: str(raw.country),
    labels: (Array.isArray(raw.labels) ? raw.labels : [])
      .filter(isObj)
      .map((l) => ({ name: str(l.name) ?? "", catno: str(l.catno) }))
      .filter((l) => l.name)
      .slice(0, 6),
    formats: (Array.isArray(raw.formats) ? raw.formats : [])
      .filter(isObj)
      .map((f) => ({ name: str(f.name) ?? "", qty: int(f.qty) ?? 1, descriptions: strs(f.descriptions, 10) }))
      .filter((f) => f.name)
      .slice(0, 6),
    genres: strs(raw.genres),
    styles: strs(raw.styles),
    tracklist,
    cover: image(str(primary?.uri) ?? str(primary?.uri150)),
    thumb: image(str(primary?.uri150) ?? str(primary?.uri)),
    identifiers: (Array.isArray(raw.identifiers) ? raw.identifiers : [])
      .filter(isObj)
      .map((i) => ({ type: str(i.type) ?? "", value: str(i.value) ?? "" }))
      .filter((i) => i.value && IDENTIFIER_TYPES.has(i.type.toLowerCase()))
      .slice(0, 12),
    discogsUrl: discogsUrlFor("release", id, raw.uri),
  };
}

/** The Discogs query parameters for each search mode. */
export function searchParamsFor(mode: SearchMode, query: string): Record<string, string> {
  switch (mode) {
    case "track":
      return { track: query, type: "release" };
    case "artist":
      return { artist: query, type: "master" };
    case "master":
      return { q: query, type: "master" };
  }
}
