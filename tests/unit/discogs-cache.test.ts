import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { discogsBucket, discogsCache, rateLimit } from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";
import { createTestDb } from "../helpers/pglite";
import { setEnv } from "../helpers/env";
import { releasePayload, searchPage1, versionsPage } from "../fixtures/discogs";

let db: AppDb;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());

beforeEach(async () => {
  vi.resetModules();
  setEnv();
  await db.delete(discogsCache);
  await db.delete(rateLimit);
  await db.delete(discogsBucket);
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const T0 = 2_000_000_000_000;

describe("cacheKey", () => {
  it("is canonical: param order, spacing and query case do not matter", async () => {
    const { cacheKey } = await import("@/server/discogs/cache");
    const a = cacheKey("https://api.discogs.com", "search", { mode: "artist", q: "  Daft   Punk ", page: 1 });
    const b = cacheKey("https://api.discogs.com", "search", { page: 1, q: "cobalt parade", mode: "artist" });
    expect(a).toBe(b);
    expect(cacheKey("https://api.discogs.com", "search", { mode: "artist", q: "cobalt parade", page: 2 })).not.toBe(a);
  });

  it("separates API origins, so a mock server never shares rows with the real API", async () => {
    const { cacheKey } = await import("@/server/discogs/cache");
    expect(cacheKey("http://localhost:3201", "release", { id: 1 })).not.toBe(cacheKey("https://api.discogs.com", "release", { id: 1 }));
  });
});

describe("TTL", () => {
  it("returns a row until expires_at, then ignores it", async () => {
    const { putCached, getCached } = await import("@/server/discogs/cache");
    const { expiresAt, fetchedAt } = await putCached(db, "k1", { a: 1 }, 100, T0);
    expect(expiresAt.getTime() - fetchedAt.getTime()).toBe(100_000);

    expect((await getCached(db, "k1", T0 + 99_000))?.payload).toEqual({ a: 1 });
    expect(await getCached(db, "k1", T0 + 100_001)).toBeNull(); // expired rows are never served
  });

  it("replaces a row on write and restarts its TTL", async () => {
    const { putCached, getCached } = await import("@/server/discogs/cache");
    await putCached(db, "k2", { v: 1 }, 10, T0);
    await putCached(db, "k2", { v: 2 }, 10, T0 + 9_000);
    expect((await getCached<{ v: number }>(db, "k2", T0 + 15_000))?.payload.v).toBe(2);
  });

  it("can never exceed 6 hours, whatever the environment says (API Terms of Use)", async () => {
    vi.resetModules();
    setEnv({ DISCOGS_CACHE_TTL_SECONDS: "86400" });
    const cfg = await import("@/server/discogs/config");
    expect(cfg.MAX_CONTENT_AGE_SECONDS).toBe(21_600);
    expect(cfg.cacheTtlSeconds()).toBe(21_600);
  });

  it("uses ONE configurable constant, defaulting to 4 hours (a 2 h margin under the 6 h cap)", async () => {
    let cfg = await import("@/server/discogs/config");
    expect(cfg.DEFAULT_CACHE_TTL_SECONDS).toBe(14_400);
    expect(cfg.cacheTtlSeconds()).toBe(14_400);

    vi.resetModules();
    setEnv({ DISCOGS_CACHE_TTL_SECONDS: "900" });
    cfg = await import("@/server/discogs/config");
    expect(cfg.cacheTtlSeconds()).toBe(900);
  });
});

describe("purge", () => {
  it("deletes expired cache rows immediately, keeps fresh ones", async () => {
    const { putCached, purgeExpired } = await import("@/server/discogs/cache");
    await putCached(db, "old", { x: 1 }, 60, T0);
    await putCached(db, "fresh", { x: 2 }, 3600, T0);
    const res = await purgeExpired(db, T0 + 61_000);
    expect(res.cacheRows).toBe(1);
    const left = await db.select({ key: discogsCache.key }).from(discogsCache);
    expect(left.map((r) => r.key)).toEqual(["fresh"]);
  });

  it("deletes stale limiter counters under our prefix, never Better Auth's rows or fresh counters", async () => {
    const { purgeExpired } = await import("@/server/discogs/cache");
    const hour = 3_600_000;
    await db.insert(rateLimit).values([
      { id: "a", key: "app:search:ip:1.1.1.1", count: 3, lastRequest: T0 - 2 * hour }, // stale, ours
      { id: "b", key: "app:search:ip:2.2.2.2", count: 3, lastRequest: T0 - 1000 }, // fresh, ours
      { id: "c", key: "1.1.1.1/sign-in/email", count: 3, lastRequest: T0 - 2 * hour }, // Better Auth's
    ]);
    const res = await purgeExpired(db, T0);
    expect(res.rateLimitRows).toBe(1);
    const keys = (await db.select({ key: rateLimit.key }).from(rateLimit)).map((r) => r.key).sort();
    expect(keys).toEqual(["1.1.1.1/sign-in/email", "app:search:ip:2.2.2.2"]);
  });

  it("purgeExpiredCache removes only expired cache rows", async () => {
    const { putCached, purgeExpiredCache } = await import("@/server/discogs/cache");
    await putCached(db, "gone", { x: 1 }, 10, T0);
    await putCached(db, "kept", { x: 2 }, 1000, T0);
    expect(await purgeExpiredCache(db, T0 + 11_000)).toBe(1);
    expect((await db.select({ key: discogsCache.key }).from(discogsCache)).map((r) => r.key)).toEqual(["kept"]);
  });
});

describe("service: cache-through", () => {
  async function svc(responses: Array<Response>, now: () => number = () => T0) {
    const { searchDiscogs, getRelease, getMasterVersions } = await import("@/server/discogs/service");
    const fetchImpl = vi.fn(async () => {
      const r = responses.shift();
      if (!r) throw new Error("no more responses");
      return r;
    });
    const deps = { db, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {}, now, random: () => 0.5 };
    return { searchDiscogs: (i: Parameters<typeof searchDiscogs>[1]) => searchDiscogs(deps, i), getRelease: (id: number) => getRelease(deps, id), getMasterVersions: (i: Parameters<typeof getMasterVersions>[1]) => getMasterVersions(deps, i), fetchImpl };
  }

  it("fetches once, then serves from cache until the TTL passes, then refetches", async () => {
    let now = T0;
    const s = await svc([json(releasePayload), json(releasePayload)], () => now);

    const first = await s.getRelease(1001);
    expect(first).toMatchObject({ ok: true, cached: false });
    const second = await s.getRelease(1001);
    expect(second).toMatchObject({ ok: true, cached: true });
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);

    now = T0 + 14_400_000 + 1; // just past 4 h
    const third = await s.getRelease(1001);
    expect(third).toMatchObject({ ok: true, cached: false });
    expect(s.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("deletes expired rows on every write: nothing is kept longer than necessary", async () => {
    const { putCached } = await import("@/server/discogs/cache");
    await putCached(db, "stale-1", { x: 1 }, 10, T0 - 3_600_000); // expired an hour ago
    await putCached(db, "stale-2", { x: 2 }, 10, T0 - 3_600_000);
    const s = await svc([json(releasePayload)]);
    await s.getRelease(1001); // a normal cache write...
    const keys = (await db.select({ key: discogsCache.key }).from(discogsCache)).map((r) => r.key);
    expect(keys).toEqual(["v1|https://api.discogs.com|release|id=1001"]); // ...removed both expired rows
  });

  it("stores only the normalised, whitelisted shape: no raw payload, no price or marketplace fields", async () => {
    const s = await svc([json(releasePayload)]);
    await s.getRelease(1001);
    const [row] = await db.select().from(discogsCache);
    const stored = JSON.stringify(row.payload);
    for (const k of ["lowest_price", "num_for_sale", "estimated_weight", "blocked_from_sale", "community", "42.5"]) {
      expect(stored).not.toContain(k);
    }
    expect(row.expiresAt.getTime() - row.fetchedAt.getTime()).toBe(14_400_000);
  });

  it("search: groups, dedupes and flags an honest 'incomplete' state", async () => {
    const s = await svc([json(searchPage1)]);
    const r = await s.searchDiscogs({ mode: "artist", query: "  Daft   Punk ", page: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.query).toBe("Cobalt Parade");
    expect(r.data.groups[0].artist).toBe("Cobalt Parade");
    expect(r.data).toMatchObject({ page: 1, pages: 3, hasMore: true, incomplete: true });
  });

  it("search: bounds the page number and says incomplete even at the cap", async () => {
    const last = { ...searchPage1, pagination: { page: 5, pages: 9, per_page: 50, items: 450 } };
    const s = await svc([json(last)]);
    const r = await s.searchDiscogs({ mode: "master", query: "discovery", page: 99 });
    expect((s.fetchImpl.mock.calls[0] as unknown as [URL])[0].searchParams.get("page")).toBe("5"); // clamped to MAX_SEARCH_PAGES
    expect(r.ok && r.data).toMatchObject({ page: 5, pages: 9, hasMore: false, incomplete: true });
  });

  it("search: a single complete page is not flagged incomplete", async () => {
    const only = { ...searchPage1, pagination: { page: 1, pages: 1, per_page: 50, items: 7 } };
    const s = await svc([json(only)]);
    const r = await s.searchDiscogs({ mode: "track", query: "slow orbit", page: 1 });
    expect(r.ok && r.data).toMatchObject({ hasMore: false, incomplete: false });
  });

  it("versions: dedupes and paginates", async () => {
    const s = await svc([json(versionsPage)]);
    const r = await s.getMasterVersions({ masterId: 500, page: 1 });
    expect(r.ok && r.data.versions.map((v) => v.id)).toEqual([11, 12, 13]);
    expect(r.ok && r.data).toMatchObject({ masterId: 500, hasMore: false, incomplete: false });
  });

  it("versions: passes filters to Discogs, caches per filter set, and returns facets", async () => {
    const filtered = { ...versionsPage, versions: versionsPage.versions.filter((v) => v.country === "Japan"), pagination: { page: 1, pages: 1, per_page: 50, items: 1 } };
    const s = await svc([json(versionsPage), json(filtered)]);

    const all = await s.getMasterVersions({ masterId: 500, page: 1 });
    expect(all.ok && all.data.facets.country.map((f) => f.value)).toEqual(["France", "Japan", "UK"]); // alphabetical
    expect(all.ok && all.data.facets.released.map((f) => f.value)).toEqual(["2001", "2002"]);
    expect(all.ok && all.data.facets.label.map((f) => f.value)).toEqual(["Victor", "Virgin"]);

    const jp = await s.getMasterVersions({ masterId: 500, page: 1, filters: { country: " Japan ", label: "", released: "" } });
    expect(jp.ok && jp.data.versions.map((v) => v.id)).toEqual([13]);
    expect(jp.ok && jp.data.filters).toEqual({ country: "Japan" });
    const params = (s.fetchImpl.mock.calls[1] as unknown as [URL])[0].searchParams;
    expect(params.get("country")).toBe("Japan");
    expect(params.has("label")).toBe(false);

    // the unfiltered and filtered requests are cached separately
    expect((await s.getMasterVersions({ masterId: 500, page: 1 })).ok).toBe(true);
    expect(s.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("passes the throttled state (with retryAfter) through to the caller and caches nothing", async () => {
    const s = await svc([new Response("", { status: 429, headers: { "retry-after": "90" } })]);
    const r = await s.getRelease(1001);
    expect(r).toEqual({ ok: false, error: "throttled", retryAfter: 90 });
    expect(await db.select().from(discogsCache)).toHaveLength(0);
  });

  it("maps 404 and malformed payloads without caching them", async () => {
    const s = await svc([new Response("", { status: 404 }), json({ unexpected: true })]);
    expect(await s.getRelease(1)).toEqual({ ok: false, error: "not_found" });
    expect(await s.getRelease(2)).toEqual({ ok: false, error: "upstream" });
    expect(await db.select().from(discogsCache)).toHaveLength(0);
  });

  it("keeps cache rows for different API origins apart", async () => {
    const s = await svc([json(releasePayload)]);
    await s.getRelease(1001);
    const [row] = await db.select().from(discogsCache).where(eq(discogsCache.key, "v1|https://api.discogs.com|release|id=1001"));
    expect(row).toBeDefined();
  });
});
