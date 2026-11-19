import type { FacetValue, MasterSummary, ReleaseCard, ReleaseDetail, ReleaseType, SearchEntry, SearchMode, TrackItem, VersionSummary } from "./types";

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
    if (uri.startsWith("/") && !uri.startsWith("//")) candidate = uri;
    else {
      try {
        const u = new URL(uri);
        if (u.protocol === "https:" && (u.hostname === "www.discogs.com" || u.hostname === "discogs.com")) candidate = u.pathname;
      } catch {
        /* not a URL */
      }
    }
    if (candidate && !candidate.startsWith("//") && /^\/[A-Za-z0-9._~%/-]+$/.test(candidate)) path = candidate;
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

/** True when a release's format list (names and descriptions) includes Vinyl. */
export const isVinyl = (formats: readonly string[]) => formats.some((f) => f.toLowerCase() === "vinyl");

const TYPE_BY_DESCRIPTOR: Record<string, ReleaseType> = {
  album: "album",
  "mini-album": "ep",
  ep: "ep",
  single: "single",
  "maxi-single": "single",
  compilation: "compilation",
};
const TYPE_PRIORITY: ReleaseType[] = ["album", "ep", "single", "compilation"];

/** Release kinds named by a hit's format descriptors ("LP, Album" -> ["album"]). */
export function releaseTypes(formats: readonly string[]): ReleaseType[] {
  const found = new Set<ReleaseType>();
  for (const f of formats) {
    const t = TYPE_BY_DESCRIPTOR[f.toLowerCase()];
    if (t) found.add(t);
  }
  return TYPE_PRIORITY.filter((t) => found.has(t));
}

/** The one label to show for an album card: an album beats an EP beats a single beats a compilation. */
export const primaryType = (types: readonly ReleaseType[] | undefined): ReleaseType | null => TYPE_PRIORITY.find((t) => types?.includes(t)) ?? null;

/** One raw search hit -> a (not yet deduped) entry, or null if it is unusable OR not vinyl. */
export function normalizeSearchHit(raw: unknown, image: ImageMapper): SearchEntry | null {
  if (!isObj(raw)) return null;
  const id = int(raw.id);
  const type = raw.type === "master" || raw.type === "release" ? raw.type : null;
  if (id === null || id <= 0 || !type) return null;

  // Vinyl only. The query already asks Discogs for format=Vinyl; this checks the answer too, wherever the field exists.
  const allFormats = strs(raw.format, 40);
  if (Array.isArray(raw.format) && !isVinyl(allFormats)) return null;

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
    formats: dedupe(allFormats).slice(0, 6),
    country: str(raw.country),
    discogsUrl: asMaster ? discogsUrlFor("master", masterId, type === "master" ? raw.uri : undefined) : discogsUrlFor("release", id, raw.uri),
    mergedHits: 1,
    types: releaseTypes(allFormats),
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
  // The request asks for format=Vinyl; verify the answer where Discogs tells us the medium. A Box Set / All Media entry
  // can contain LPs, so it stays; a row that is only CD, File or Cassette does not.
  const majors = strs(raw.major_formats, 8);
  if (majors.length && !majors.some((m) => ["vinyl", "box set", "all media"].includes(m.toLowerCase()))) return null;
  // Medium first ("Vinyl"), then the descriptors ("LP, Album"), so a card that shows only a few says what it is.
  const formats = dedupe([
    ...strs(raw.major_formats, 4),
    ...(str(raw.format)?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
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

const FACET_CAP = 300;

function decodeFacet(v: string | null): string | null {
  if (v === null) return null;
  try {
    return decodeURIComponent(v.replace(/\+/g, " ")).trim() || null;
  } catch {
    return v; // not valid percent-encoding: use as is
  }
}

/** Discogs `filter_facets`: [{ id: "country", values: [{ value, title, count }] }, ...] -> the three we filter by. */
export function normalizeFacets(raw: unknown): { country: FacetValue[]; released: FacetValue[]; label: FacetValue[] } {
  const out = { country: [] as FacetValue[], released: [] as FacetValue[], label: [] as FacetValue[] };
  if (!Array.isArray(raw)) return out;
  for (const f of raw) {
    if (!isObj(f)) continue;
    const id = str(f.id);
    if (id !== "country" && id !== "released" && id !== "label") continue;
    const seen = new Set<string>();
    const values: FacetValue[] = [];
    for (const v of Array.isArray(f.values) ? f.values : []) {
      if (!isObj(v)) continue;
      // Discogs sends `value` form-encoded ("Germany%2C+Austria%2C+%26+Switzerland") and `title` readable. The filter takes
      // the plain text (our request encodes it again), so decode: the encoded form would be shown AND double-encoded.
      const value = decodeFacet(str(v.value)) ?? str(v.title);
      if (!value || seen.has(value)) continue;
      seen.add(value);
      values.push({ value, count: Math.max(0, int(v.count) ?? 0) });
    }
    values.sort((a, b) => (id === "released" ? a.value.localeCompare(b.value) : a.value.localeCompare(b.value, "en", { sensitivity: "base" })));
    out[id] = values.slice(0, FACET_CAP);
  }
  return out;
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
    facets: normalizeFacets(o.filter_facets),
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

/**
 * The Discogs query for each search mode. ALWAYS vinyl RELEASES: evidence (real API, 2026-11-16) showed that
 *  - searching masters cannot be filtered by medium (a master's `format` is its main release's, often an MP3), and
 *  - track= only works on releases.
 * Results are grouped by master afterwards. `by` narrows a track or album search to one artist.
 */
export function searchParamsFor(mode: SearchMode, query: string, by?: string | null): Record<string, string> {
  const base: Record<string, string> = { type: "release", format: "Vinyl" };
  switch (mode) {
    case "track":
      base.track = query;
      break;
    case "artist":
      base.artist = query;
      break;
    case "album":
      base.release_title = query;
      break;
  }
  if (by && mode !== "artist") base.artist = by;
  return base;
}

/** /masters/{id} -> the album's own title, year and cover. A whitelist: the master record also carries price fields. */
export function normalizeMaster(raw: unknown, image: ImageMapper): MasterSummary | null {
  if (!isObj(raw)) return null;
  const id = int(raw.id);
  const title = str(raw.title);
  if (id === null || id <= 0 || !title) return null;
  const artists = (Array.isArray(raw.artists) ? raw.artists : []).filter(isObj).map((a) => str(a.anv) ?? str(a.name)).filter((n): n is string => n !== null);
  const images = (Array.isArray(raw.images) ? raw.images : []).filter(isObj);
  const primary = images.find((i) => i.type === "primary") ?? images[0];
  return {
    id,
    title,
    artist: artists.length ? artists.join(", ") : null,
    year: year(raw.year),
    thumb: image(str(primary?.uri150) ?? str(primary?.uri)),
    discogsUrl: discogsUrlFor("master", id, raw.uri),
  };
}

/** The list-card view of a release (what is shown for an item on a list). */
export function toReleaseCard(r: ReleaseDetail): ReleaseCard {
  const fmt = r.formats[0];
  return {
    id: r.id,
    masterId: r.masterId,
    title: r.title,
    artist: r.artist,
    year: r.year,
    country: r.country,
    label: r.labels[0]?.name ?? null,
    catno: r.labels[0]?.catno ?? null,
    format: fmt ? [fmt.name, ...fmt.descriptions].join(", ") : null,
    thumb: r.thumb ?? r.cover,
    discogsUrl: r.discogsUrl,
  };
}
