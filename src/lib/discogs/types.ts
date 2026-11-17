/**
 * Shapes shared by the server and the UI. These are OUR types, built from a whitelist of Discogs
 * fields (see normalize.ts): nothing price- or marketplace-related can appear here by construction.
 */

/** What the user types. All three search VINYL RELEASES (type=release, format=Vinyl) and group them by master. */
export type SearchMode = "track" | "artist" | "album";

/** What kind of release it is, derived ONLY from the format descriptors Discogs already sends with each hit. */
export type ReleaseType = "album" | "ep" | "single" | "compilation";

export interface SearchEntry {
  /** Stable key used for dedupe: `m:<masterId>` or `r:<releaseId>`. */
  key: string;
  /** `master` = a master release (open it to see its pressings); `release` = a standalone pressing (master_id = 0). */
  kind: "master" | "release";
  /** Master id when kind = master, release id when kind = release. */
  id: number;
  artist: string | null;
  title: string;
  year: number | null;
  /** Same-origin proxy URL (`/api/discogs/image?...`) or null. Never a discogs.com URL. */
  thumb: string | null;
  formats: string[];
  country: string | null;
  /** Page on discogs.com, for the "Data provided by Discogs" link next to this item. */
  discogsUrl: string;
  /** How many raw search hits were merged into this entry (>= 1). */
  mergedHits: number;
  /** Kinds seen across the merged releases (e.g. ["album"]); empty when the descriptors say nothing. Older cached rows may lack it. */
  types: ReleaseType[];
  /** True when this entry's data comes from the master record itself (not from one of its releases). */
  fromMaster: boolean;
}

export interface ArtistGroup {
  /** Normalised artist key (lowercase, no diacritics). `""` groups results whose artist could not be parsed. */
  key: string;
  artist: string | null;
  entries: SearchEntry[];
}

export interface Page {
  page: number;
  pages: number;
  perPage: number;
  totalItems: number;
  /** More pages exist AND we are still allowed to fetch them (bounded by MAX_*_PAGES). */
  hasMore: boolean;
  /**
   * True whenever what we have shown is not everything Discogs matched (more pages, or the page cap was hit).
   * The UI must say "results may be incomplete" when this is true.
   */
  incomplete: boolean;
}

export interface SearchPage extends Page {
  mode: SearchMode;
  query: string;
  /** Optional artist the track / album search was narrowed to. */
  by: string | null;
  groups: ArtistGroup[];
}

export interface VersionSummary {
  id: number;
  title: string;
  label: string | null;
  catno: string | null;
  country: string | null;
  released: string | null;
  formats: string[];
  thumb: string | null;
  discogsUrl: string;
}

export interface FacetValue {
  value: string;
  count: number;
}

/** Filters Discogs supports on a master's versions. `released` is a year. */
export interface VersionFilters {
  country?: string;
  released?: string;
  label?: string;
}

export interface VersionsPage extends Page {
  masterId: number;
  versions: VersionSummary[];
  /** Options for the filter dropdowns, as reported by Discogs for the current (filtered) result set. */
  facets: { country: FacetValue[]; released: FacetValue[]; label: FacetValue[] };
  /** The filters this page was fetched with. */
  filters: VersionFilters;
}

export interface TrackItem {
  position: string;
  title: string;
  duration: string | null;
  /** Discogs `type_`: `track`, `heading` or `index`. */
  type: string;
}

export interface ReleaseDetail {
  id: number;
  masterId: number | null;
  title: string;
  /** Artists joined the way Discogs displays them. */
  artist: string | null;
  artists: { id: number | null; name: string }[];
  year: number | null;
  released: string | null;
  country: string | null;
  labels: { name: string; catno: string | null }[];
  formats: { name: string; qty: number; descriptions: string[] }[];
  genres: string[];
  styles: string[];
  tracklist: TrackItem[];
  /** Proxy URLs. */
  cover: string | null;
  thumb: string | null;
  /** Barcode / matrix / runout strings that help tell pressings apart. */
  identifiers: { type: string; value: string }[];
  discogsUrl: string;
}

/** A master release, resolved from /masters/{id}: the album's own title, year and cover (not a single release's). */
export interface MasterSummary {
  id: number;
  title: string;
  artist: string | null;
  year: number | null;
  thumb: string | null;
  discogsUrl: string;
}

/** Result of resolving a few masters in one call. `missing` ids could not be resolved right now (see `retryAfter`). */
export interface MastersBatch {
  masters: MasterSummary[];
  missing: number[];
  retryAfter?: number;
}

/** What a list card shows of a release: a trimmed view of ReleaseDetail (no tracklist, identifiers or style lists). */
export interface ReleaseCard {
  id: number;
  masterId: number | null;
  title: string;
  artist: string | null;
  year: number | null;
  country: string | null;
  label: string | null;
  catno: string | null;
  /** e.g. "Vinyl, LP, Album" as Discogs describes the pressing. */
  format: string | null;
  thumb: string | null;
  discogsUrl: string;
}

/** Result of resolving the releases of one list page. `gone` ids no longer exist on Discogs; `missing` ones could not be resolved right now. */
export interface ReleasesBatch {
  releases: ReleaseCard[];
  gone: number[];
  missing: number[];
  retryAfter?: number;
}

export type DiscogsErrorCode =
  | "throttled" // Discogs budget exhausted; retry after `retryAfter` seconds
  | "not_found"
  | "unconfigured" // no Discogs credentials in the environment
  | "upstream"; // Discogs failed (5xx, auth, network)

/** What the service layer returns. `retryAfter` (seconds) is present for `throttled`. */
export type DiscogsResult<T> =
  | { ok: true; data: T; cached: boolean; fetchedAt: string }
  | { ok: false; error: DiscogsErrorCode; retryAfter?: number };

/** JSON error body of the HTTP API (what the UI receives). `scope` says whose limit was hit. */
export interface ApiErrorBody {
  error: DiscogsErrorCode | "rate_limited" | "bad_request" | "forbidden" | "unauthorized";
  scope?: "discogs" | "app";
  retryAfter?: number;
  message?: string;
}
