import { artistKey } from "./discogs/normalize";

/**
 * Where the person is in the finder (track -> artist -> album -> pressing -> release card), kept ENTIRELY in the URL, so the
 * Back links, the browser's Back button, a reload and a copied link all return to the same step with the same query, artist,
 * "show more" state and filters. Pure (no React, no browser), so the parsing can be unit-tested: every value that comes from
 * the address bar is untrusted and falls back to a safe default instead of throwing.
 *
 *   search / albums : mode, q, by, g (artist key), n (albums views shown), sp (search pages loaded), o (other pressings open)
 *   pressings       : the same, plus a / t (artist and album title for the heading), country / released / label, vp (pages loaded)
 *   release card    : the same as pressings (it is only a carrier, so "Back" can rebuild the pressings page)
 *
 * Defaults are left out of the URL, so a plain first visit stays a short address.
 */

export const MODES = ["track", "artist", "album"] as const;
export type Mode = (typeof MODES)[number];

/** `g` value for "artist unknown". */
export const UNKNOWN_KEY = "-";

/** Mirrors MAX_SEARCH_PAGES / MAX_VERSION_PAGES in src/server/discogs/config.ts (a unit test keeps them equal). */
export const MAX_SEARCH_PAGES = 5;
export const MAX_VERSION_PAGES = 10;
/** "Show more albums" views. Each view resolves up to 12 master records, so a tampered `n=999` must not fan out. */
export const MAX_ALBUM_VIEWS = 10;

const TEXT_MAX = 100;
const NAME_MAX = 200;

type Params = { get(name: string): string | null };

const CONTROL = /[\u0000-\u001f\u007f]/g;
const text = (v: string | null, max: number) => (v ?? "").replace(CONTROL, " ").trim().slice(0, max);
const integer = (v: string | null, min: number, max: number) => {
  if (v === null || !/^\d{1,3}$/.test(v)) return min;
  return Math.min(max, Math.max(min, Number(v)));
};

export interface FinderState {
  mode: Mode;
  q: string;
  /** The optional artist that narrows a track or album search. Always "" in artist mode. */
  by: string;
  /** Group key of the artist whose albums are shown, or null for the artist list. */
  g: string | null;
  /** How many "views" of 12 albums are shown (1 = the first). */
  views: number;
  /** How many pages of search results are loaded (1 = the first). */
  searchPages: number;
  /** The collapsed "Other pressings without a master" section was opened. */
  othersOpen: boolean;
}

export function parseFinder(params: Params): FinderState {
  const rawMode = params.get("mode");
  const mode: Mode = (MODES as readonly string[]).includes(rawMode ?? "") ? (rawMode as Mode) : "track";
  const g = text(params.get("g"), NAME_MAX);
  return {
    mode,
    q: text(params.get("q"), TEXT_MAX),
    by: mode === "artist" ? "" : text(params.get("by"), TEXT_MAX),
    g: g || null,
    views: integer(params.get("n"), 1, MAX_ALBUM_VIEWS),
    searchPages: integer(params.get("sp"), 1, MAX_SEARCH_PAGES),
    othersOpen: params.get("o") === "1",
  };
}

/** Query for /search. Empty when there is no query (the plain search start). */
export function finderQuery(s: FinderState): Record<string, string> {
  if (!s.q) return {};
  return {
    mode: s.mode,
    q: s.q,
    ...(s.by && s.mode !== "artist" ? { by: s.by } : {}),
    ...(s.g ? { g: s.g } : {}),
    ...(s.g && s.views > 1 ? { n: String(s.views) } : {}),
    ...(s.searchPages > 1 ? { sp: String(s.searchPages) } : {}),
    ...(s.g && s.othersOpen ? { o: "1" } : {}),
  };
}

export interface MasterState {
  /** Artist and album title, only for the heading. */
  a: string | null;
  t: string | null;
  country?: string;
  released?: string;
  label?: string;
  /** How many pages of pressings are loaded. */
  versionPages: number;
}

export function parseMaster(params: Params): MasterState {
  const opt = (name: string) => text(params.get(name), TEXT_MAX) || undefined;
  return {
    a: text(params.get("a"), NAME_MAX) || null,
    t: text(params.get("t"), NAME_MAX) || null,
    country: opt("country"),
    released: opt("released"),
    label: opt("label"),
    versionPages: integer(params.get("vp"), 1, MAX_VERSION_PAGES),
  };
}

export function masterQuery(m: MasterState): Record<string, string> {
  return {
    ...(m.a ? { a: m.a } : {}),
    ...(m.t ? { t: m.t } : {}),
    ...(m.country ? { country: m.country } : {}),
    ...(m.released ? { released: m.released } : {}),
    ...(m.label ? { label: m.label } : {}),
    ...(m.versionPages > 1 ? { vp: String(m.versionPages) } : {}),
  };
}

/** Everything the pressings page and the release card carry, so "Back" can rebuild the previous step exactly. */
export const contextQuery = (f: FinderState, m: MasterState): Record<string, string> => ({ ...finderQuery(f), ...masterQuery(m) });

/**
 * The albums list an album or pressing came from. Old or hand-made links carry no `g`: then the artist's name from the heading
 * stands in (the same key the search groups by). The artist list is the answer when no artist is known at all.
 */
export function albumsBackQuery(f: FinderState, m: Pick<MasterState, "a">): Record<string, string> {
  const g = f.g ?? (m.a ? artistKey(m.a) || UNKNOWN_KEY : null);
  return finderQuery({ ...f, g });
}

/** "Choose another artist": the artist list of the same search (artist-level state is dropped, the loaded pages are kept). */
export const artistsBackQuery = (f: FinderState): Record<string, string> => finderQuery({ ...f, g: null });

/** Next.js `searchParams` (an object) in the shape the parsers read. Only the first value of a repeated parameter counts. */
export function fromRecord(record: Record<string, string | string[] | undefined>): Params {
  return { get: (name) => (Array.isArray(record[name]) ? (record[name]![0] ?? null) : (record[name] ?? null)) };
}

/** `/path?a=b` from a path and a query object (what the sign-in page's `next` expects). */
export function withQuery(pathname: string, query: Record<string, string>): string {
  const qs = new URLSearchParams(query).toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
