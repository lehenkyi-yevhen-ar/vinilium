import "server-only";
import { groupByArtist } from "@/lib/discogs/group";
import {
  normalizeRelease,
  normalizeSearchResponse,
  normalizeVersionsResponse,
  searchParamsFor,
} from "@/lib/discogs/normalize";
import type { DiscogsResult, ReleaseDetail, SearchMode, SearchPage, VersionsPage } from "@/lib/discogs/types";
import { cacheKey, getCached, purgeExpired, putCached, shouldPurgeOpportunistically } from "./cache";
import { discogsGet, type ClientDeps, type RequestOutcome } from "./client";
import { apiBase, cacheTtlSeconds, MAX_SEARCH_PAGES, MAX_VERSION_PAGES, PAGE_SIZE } from "./config";
import { imageMapper } from "./image";
import type { AppDb } from "./token-bucket";

type Deps = Omit<ClientDeps, "db"> & { db: AppDb };

/** Cache-through: fresh row -> return it; otherwise ask Discogs, normalise, store with the TTL. */
async function cached<T>(
  deps: Deps,
  key: string,
  request: () => Promise<RequestOutcome>,
  build: (json: unknown) => T | null,
): Promise<DiscogsResult<T>> {
  const now = (deps.now ?? Date.now)();
  const hit = await getCached<T>(deps.db, key, now);
  if (hit) return { ok: true, data: hit.payload, cached: true, fetchedAt: hit.fetchedAt.toISOString() };

  const out = await request();
  if (!out.ok) {
    return out.kind === "throttled"
      ? { ok: false, error: "throttled", retryAfter: out.retryAfter }
      : { ok: false, error: out.kind === "upstream" ? "upstream" : out.kind };
  }

  const data = build(out.json);
  if (data === null) return { ok: false, error: "upstream" }; // 200 but not the shape we expect

  const { fetchedAt } = await putCached(deps.db, key, data, cacheTtlSeconds(), now);
  if (shouldPurgeOpportunistically()) void purgeExpired(deps.db, now).catch(() => {});
  return { ok: true, data, cached: false, fetchedAt: fetchedAt.toISOString() };
}

const pageFlags = (page: number, pages: number, cap: number) => ({
  hasMore: page < Math.min(pages, cap),
  // Not everything Discogs matched is on screen: more pages exist (fetchable or beyond our cap).
  incomplete: page < pages,
});

export function normalizeQuery(q: string): string {
  return q.normalize("NFC").trim().replace(/\s+/g, " ");
}

export async function searchDiscogs(deps: Deps, input: { mode: SearchMode; query: string; page: number }): Promise<DiscogsResult<SearchPage>> {
  const query = normalizeQuery(input.query);
  const page = Math.min(Math.max(1, Math.trunc(input.page) || 1), MAX_SEARCH_PAGES);
  const params = { ...searchParamsFor(input.mode, query), per_page: PAGE_SIZE, page };
  const key = cacheKey(apiBase(), "search", { mode: input.mode, q: query, page, per_page: PAGE_SIZE });

  return cached<SearchPage>(
    deps,
    key,
    () => discogsGet("/database/search", params, deps),
    (json) => {
      const r = normalizeSearchResponse(json, imageMapper());
      return {
        mode: input.mode,
        query,
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

export async function getMasterVersions(deps: Deps, input: { masterId: number; page: number }): Promise<DiscogsResult<VersionsPage>> {
  const page = Math.min(Math.max(1, Math.trunc(input.page) || 1), MAX_VERSION_PAGES);
  const key = cacheKey(apiBase(), "versions", { master: input.masterId, page, per_page: PAGE_SIZE });

  return cached<VersionsPage>(
    deps,
    key,
    () => discogsGet(`/masters/${input.masterId}/versions`, { per_page: PAGE_SIZE, page }, deps),
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
