import "server-only";
import { groupByArtist } from "@/lib/discogs/group";
import {
  normalizeMaster,
  normalizeRelease,
  toReleaseCard,
  normalizeSearchResponse,
  normalizeVersionsResponse,
  searchParamsFor,
} from "@/lib/discogs/normalize";
import { MAX_RELEASES_PER_BATCH } from "@/lib/lists/rules";
import type { DiscogsResult, MasterSummary, MastersBatch, ReleaseDetail, ReleasesBatch, SearchMode, SearchPage, VersionFilters, VersionsPage } from "@/lib/discogs/types";
import { cacheKey, getCached, getCachedMany, purgeExpiredCache, putCached, putCachedMany } from "./cache";
import { discogsGet, type ClientDeps, type RequestOutcome } from "./client";
import { apiBase, cacheTtlSeconds, MAX_SEARCH_PAGES, MAX_VERSION_PAGES, PAGE_SIZE } from "./config";
import { imageMapper } from "./image";
import { cut, stripControl } from "@/lib/text";
import { count } from "@/server/metrics";
import type { AppDb } from "./token-bucket";

/** Everything in this app is about vinyl; the medium is a constant, not a user choice. */
const VINYL = "Vinyl";

/** The most masters resolved in one call. Each costs one Discogs request when it is not cached yet. */
export const MAX_MASTERS_PER_BATCH = 12;

type Deps = Omit<ClientDeps, "db"> & {
  db: AppDb;
  /** Takes one unit of the caller's cold-fetch allowance (see cold-limit.ts). Called before every upstream call a batch makes. */
  coldLimit?: () => Promise<{ allowed: boolean; retryAfter: number }>;
};

/** Cache-through: fresh row -> return it; otherwise ask Discogs, normalise, store with the TTL. */
async function cached<T>(
  deps: Deps,
  key: string,
  request: () => Promise<RequestOutcome>,
  build: (json: unknown) => T | null,
): Promise<DiscogsResult<T>> {
  const now = (deps.now ?? Date.now)();
  const hit = await getCached<T>(deps.db, key, now);
  if (hit) {
    count("cache_hits");
    return { ok: true, data: hit.payload, cached: true, fetchedAt: hit.fetchedAt.toISOString() };
  }
  count("cache_misses");

  if (deps.coldLimit) {
    // Not cached, so this request would spend Discogs budget: ask the caller's cold allowance first. Refused = the same answer as a
    // Discogs throttle (a countdown on screen), and nothing is sent upstream.
    const allowance = await deps.coldLimit();
    if (!allowance.allowed) {
      count("cap_hits");
      return { ok: false, error: "throttled", retryAfter: allowance.retryAfter };
    }
  }

  const out = await request();
  if (!out.ok) {
    return out.kind === "throttled"
      ? { ok: false, error: "throttled", retryAfter: out.retryAfter }
      : { ok: false, error: out.kind === "upstream" ? "upstream" : out.kind };
  }

  const data = build(out.json);
  if (data === null) return { ok: false, error: "upstream" }; // 200 but not the shape we expect

  const { fetchedAt } = await putCached(deps.db, key, data, cacheTtlSeconds(), now);
  await purgeExpiredCache(deps.db, now).catch(() => {}); // never keep expired Content around; a purge failure must not fail the request
  return { ok: true, data, cached: false, fetchedAt: fetchedAt.toISOString() };
}

const pageFlags = (page: number, pages: number, cap: number) => ({
  hasMore: page < Math.min(pages, cap),
  // Not everything Discogs matched is on screen: more pages exist (fetchable or beyond our cap).
  incomplete: page < pages,
});

export function normalizeQuery(q: string): string {
  return stripControl(q).normalize("NFC").trim().replace(/\s+/g, " ");
}

export async function searchDiscogs(
  deps: Deps,
  input: { mode: SearchMode; query: string; by?: string | null; page: number },
): Promise<DiscogsResult<SearchPage>> {
  const query = normalizeQuery(input.query);
  const by = input.mode === "artist" || !input.by ? null : cut(normalizeQuery(input.by), 100) || null;
  const page = Math.min(Math.max(1, Math.trunc(input.page) || 1), MAX_SEARCH_PAGES);
  const params = { ...searchParamsFor(input.mode, query, by), per_page: PAGE_SIZE, page };
  const key = cacheKey(apiBase(), "search", { mode: input.mode, q: query, by: by ?? "", page, per_page: PAGE_SIZE });

  return cached<SearchPage>(
    deps,
    key,
    () => discogsGet("/database/search", params, deps),
    (json) => {
      const r = normalizeSearchResponse(json, imageMapper());
      return {
        mode: input.mode,
        query,
        by,
        page: r.page,
        pages: r.pages,
        perPage: r.perPage,
        totalItems: r.totalItems,
        ...pageFlags(r.page, r.pages, MAX_SEARCH_PAGES),
        groups: groupByArtist(r.entries),
      };
    },
  );
}

/** Only these three are passed to Discogs; blanks are dropped so equivalent requests share a cache row. */
export function cleanFilters(f: VersionFilters | undefined): VersionFilters {
  const out: VersionFilters = {};
  for (const k of ["country", "released", "label"] as const) {
    const v = f?.[k] === undefined ? undefined : stripControl(f[k]!).normalize("NFC").trim().replace(/\s+/g, " ");
    if (v) out[k] = cut(v, 100);
  }
  return out;
}

export async function getMasterVersions(
  deps: Deps,
  input: { masterId: number; page: number; filters?: VersionFilters },
): Promise<DiscogsResult<VersionsPage>> {
  const page = Math.min(Math.max(1, Math.trunc(input.page) || 1), MAX_VERSION_PAGES);
  const filters = cleanFilters(input.filters);
  const key = cacheKey(apiBase(), "versions", { master: input.masterId, page, per_page: PAGE_SIZE, format: VINYL, ...filters });

  return cached<VersionsPage>(
    deps,
    key,
    () => discogsGet(`/masters/${input.masterId}/versions`, { per_page: PAGE_SIZE, page, format: VINYL, ...filters }, deps),
    (json) => {
      const r = normalizeVersionsResponse(json, imageMapper());
      return {
        masterId: input.masterId,
        page: r.page,
        pages: r.pages,
        perPage: r.perPage,
        totalItems: r.totalItems,
        ...pageFlags(r.page, r.pages, MAX_VERSION_PAGES),
        versions: r.versions,
        facets: r.facets,
        filters,
      };
    },
  );
}

export async function getRelease(deps: Deps, releaseId: number): Promise<DiscogsResult<ReleaseDetail>> {
  const key = cacheKey(apiBase(), "release", { id: releaseId });
  return cached<ReleaseDetail>(
    deps,
    key,
    () => discogsGet(`/releases/${releaseId}`, {}, deps),
    (json) => normalizeRelease(json, imageMapper()),
  );
}

/** Concurrent Discogs requests inside ONE batch. Every request still takes its token from the shared bucket, so this never
 *  raises the request RATE: it only stops the calls from waiting in line behind each other. */
export const BATCH_CONCURRENCY = 4;
/** How long "this id does not exist on Discogs" is remembered (it is an absence, but asking again for every page view is waste). */
export const GONE_TTL_SECONDS = 3_600;

export interface BatchResult<T> {
  found: Map<number, T>;
  /** Ids Discogs says do not exist (404). */
  gone: Set<number>;
  /** Ids that could not be resolved right now (throttled, failed): the caller shows them as pending / retryable. */
  missing: number[];
  /** Set when Discogs asked us to slow down; stop launching and try again after this many seconds. */
  retryAfter?: number;
  unconfigured: boolean;
  fetchedAt: Date;
  /** Number of Discogs calls that succeeded or answered 404 (the ones that cost budget). */
  upstreamCalls: number;
  /** Oldest fetchedAt among everything returned: what the freshness rule must look at. */
  oldestFetchedAt: Date;
}

/**
 * Cache-through for MANY ids at once: one query for all cache rows, a small concurrent pool for the rest, one insert for the
 * results. Used by the albums step (masters) and the list screens (releases).
 */
export async function batchCached<T>(
  deps: Deps,
  spec: { kind: "master" | "release"; ids: number[]; build: (json: unknown) => T | null; path: (id: number) => string },
): Promise<BatchResult<T>> {
  const now = (deps.now ?? Date.now)();
  const origin = apiBase();
  const key = (id: number) => cacheKey(origin, spec.kind, { id });
  const goneKey = (id: number) => cacheKey(origin, "gone", { kind: spec.kind, id });

  const ids = [...new Set(spec.ids)];
  const [hits, goneHits] = await Promise.all([
    getCachedMany<T>(deps.db, ids.map(key), now),
    getCachedMany<{ gone: true }>(deps.db, ids.map(goneKey), now),
  ]);

  count("cache_hits", hits.size + goneHits.size);
  count("cache_misses", ids.length - hits.size - goneHits.size);
  const found = new Map<number, T>();
  const gone = new Set<number>();
  let oldest = now;
  const todo: number[] = [];
  for (const id of ids) {
    const h = hits.get(key(id));
    if (h) {
      found.set(id, h.payload);
      oldest = Math.min(oldest, h.fetchedAt.getTime());
    } else if (goneHits.has(goneKey(id))) {
      gone.add(id);
    } else todo.push(id);
  }

  // Every answer is written to the cache THE MOMENT it arrives, not once at the end: if the function is cut off by a platform
  // time limit halfway through a cold batch, the Discogs calls already made are not wasted (the next request finds them cached).
  // `now` stays the batch's start time, as before: TTLs are measured from there, so nothing is ever kept longer than before.
  type Entry = { key: string; payload: unknown; ttlSeconds: number };
  const unsaved: Entry[] = []; // writes that failed; tried once more together at the end
  let saved = 0;
  async function persist(entry: Entry) {
    try {
      await putCachedMany(deps.db, [entry], now);
      saved++;
    } catch {
      unsaved.push(entry);
    }
  }
  const failed = new Set<number>();
  let retryAfter: number | undefined;
  let unconfigured = false;
  let upstreamCalls = 0;
  let cursor = 0;

  async function worker() {
    for (;;) {
      if (retryAfter !== undefined || unconfigured) return; // being throttled: do not launch anything new
      const id = todo[cursor++];
      if (id === undefined) return;
      if (deps.coldLimit) {
        const allowance = await deps.coldLimit();
        if (!allowance.allowed) {
          // Over this person's allowance: stop launching, exactly like a Discogs throttle (the screen shows a countdown, not an error).
          count("cap_hits");
          retryAfter = Math.max(retryAfter ?? 0, allowance.retryAfter);
          return;
        }
      }
      const out = await discogsGet(spec.path(id), {}, deps);
      if (out.ok) {
        upstreamCalls++;
        const built = spec.build(out.json);
        if (built === null) failed.add(id);
        else {
          found.set(id, built);
          await persist({ key: key(id), payload: built, ttlSeconds: cacheTtlSeconds() });
        }
      } else if (out.kind === "not_found") {
        upstreamCalls++;
        gone.add(id);
        await persist({ key: goneKey(id), payload: { gone: true }, ttlSeconds: Math.min(GONE_TTL_SECONDS, cacheTtlSeconds()) });
      } else if (out.kind === "throttled") {
        retryAfter = Math.max(retryAfter ?? 0, out.retryAfter);
      } else if (out.kind === "unconfigured") {
        unconfigured = true;
      } else failed.add(id);
    }
  }
  await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, todo.length) }, worker));

  if (unsaved.length) {
    await putCachedMany(deps.db, unsaved, now); // as before, a cache that cannot be written at all fails the request
    saved += unsaved.length;
  }
  const fetchedAt = new Date(now);
  if (saved) {
    oldest = Math.min(oldest, fetchedAt.getTime());
    await purgeExpiredCache(deps.db, now).catch(() => {});
  }
  const missing = ids.filter((id) => !found.has(id) && !gone.has(id));
  return { found, gone, missing, ...(retryAfter !== undefined ? { retryAfter } : {}), unconfigured, fetchedAt, upstreamCalls, oldestFetchedAt: new Date(oldest) };
}

/**
 * Resolve a few masters (title, year, cover) for the albums step. Cached one by one (TTL), looked up through the shared
 * budget by a small concurrent pool. If Discogs asks us to slow down we stop launching and report what is `missing` with a
 * `retryAfter`, so the screen can show what it has instead of failing.
 */
export async function getMasters(deps: Deps, ids: number[]): Promise<DiscogsResult<MastersBatch>> {
  const wanted = [...new Set(ids)].slice(0, MAX_MASTERS_PER_BATCH);
  const image = imageMapper();
  const r = await batchCached<MasterSummary>(deps, { kind: "master", ids: wanted, build: (j) => normalizeMaster(j, image), path: (id) => `/masters/${id}` });
  if (r.unconfigured && r.found.size === 0) return { ok: false, error: "unconfigured" };
  return {
    ok: true,
    data: {
      masters: wanted.filter((id) => r.found.has(id)).map((id) => r.found.get(id)!),
      missing: wanted.filter((id) => !r.found.has(id)),
      ...(r.retryAfter !== undefined ? { retryAfter: r.retryAfter } : {}),
    },
    cached: r.upstreamCalls === 0,
    fetchedAt: r.oldestFetchedAt.toISOString(),
  };
}

/** The most releases resolved in one call: the largest list page. */


/**
 * Resolve the releases of ONE list page. Shares the single-release cache key with getRelease, so a release seen in the finder
 * costs nothing here (and the other way round). Anything Discogs does not know (404) is `gone`; anything not resolvable right
 * now (throttled, failed) is `missing`, with a `retryAfter` when Discogs asked us to slow down.
 */
export async function getReleases(deps: Deps, ids: number[]): Promise<DiscogsResult<ReleasesBatch>> {
  const wanted = [...new Set(ids)].slice(0, MAX_RELEASES_PER_BATCH);
  const image = imageMapper();
  const r = await batchCached<ReleaseDetail>(deps, {
    kind: "release",
    ids: wanted,
    build: (j) => normalizeRelease(j, image),
    path: (id) => `/releases/${id}`,
  });
  if (r.unconfigured && r.found.size === 0 && r.gone.size === 0) return { ok: false, error: "unconfigured" };
  return {
    ok: true,
    data: {
      releases: wanted.filter((id) => r.found.has(id)).map((id) => toReleaseCard(r.found.get(id)!)),
      gone: wanted.filter((id) => r.gone.has(id)),
      missing: r.missing,
      ...(r.retryAfter !== undefined ? { retryAfter: r.retryAfter } : {}),
    },
    cached: r.upstreamCalls === 0,
    fetchedAt: r.oldestFetchedAt.toISOString(),
  };
}
