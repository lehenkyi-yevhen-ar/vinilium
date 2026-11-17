/**
 * Rules shared by the list API and the list screens. Pure and client-safe (no server-only import).
 * Everything here is about the user's OWN fields (added date, notes, condition): never Discogs content.
 */

export const LISTS = ["wishlist", "collection"] as const;
export type ListName = (typeof LISTS)[number];
export const isListName = (v: unknown): v is ListName => typeof v === "string" && (LISTS as readonly string[]).includes(v);
export const otherList = (l: ListName): ListName => (l === "wishlist" ? "collection" : "wishlist");

/** Goldmine grades, best first. Stored as the short code. */
export const CONDITIONS = ["M", "NM", "VG+", "VG", "G+", "G", "F", "P"] as const;
export type Condition = (typeof CONDITIONS)[number];
export const isCondition = (v: unknown): v is Condition => typeof v === "string" && (CONDITIONS as readonly string[]).includes(v);

export const NOTES_MAX = 2_000;

/** Items per page: 12 on a phone-sized list, 24 for people who prefer scrolling. */
export const PAGE_SIZES = [12, 24] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 12;
export const isPageSize = (v: unknown): v is PageSize => PAGE_SIZES.includes(v as PageSize);

/** Sorting and searching are possible ONLY on stored fields: added date, notes, condition. Titles and artists are Discogs content. */
export const SORTS = ["added", "notes", "condition"] as const;
export type SortKey = (typeof SORTS)[number];
export type SortDir = "asc" | "desc";
export const isSortKey = (v: unknown): v is SortKey => typeof v === "string" && (SORTS as readonly string[]).includes(v);

/** Condition is a Collection-only field, so it is the only sort that does not exist on the Wishlist. */
export const sortAllowed = (list: ListName, sort: SortKey) => sort !== "condition" || list === "collection";

/** The Discogs data of one list page is fetched in ONE batch of at most this many ids (= the largest page size). */
export const MAX_RELEASES_PER_BATCH = 24;

export interface StoredItemJson {
  releaseId: number;
  list: ListName;
  notes: string | null;
  conditionMedia: Condition | null;
  conditionSleeve: Condition | null;
  addedAt: string;
  updatedAt: string;
}

export interface ListPageJson {
  list: ListName;
  items: StoredItemJson[];
  total: number;
  page: number;
  pages: number;
  pageSize: PageSize;
  counts: Record<ListName, number>;
  /** The query this page answers, echoed so the screen can show chips and the empty state correctly. */
  q: string;
  sort: SortKey;
  dir: SortDir;
}
