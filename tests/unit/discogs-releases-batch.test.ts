import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { discogsBucket, discogsCache } from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";
import { createTestDb } from "../helpers/pglite";
import { setEnv } from "../helpers/env";

/** The batch behind the list screens: GET /api/discogs/releases?ids=... (SYNTHETIC release records). */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const release = (id: number) => ({
  id,
  title: `Record ${id}`,
  master_id: 5000 + id,
  year: 1999,
  country: "Norway",
  uri: `https://www.discogs.com/release/${id}-Record`,
  artists: [{ id: 1, name: "Test Artist" }],
  labels: [{ name: "Test Label", catno: `TL-${id}` }],
  formats: [{ name: "Vinyl", qty: 1, descriptions: ["LP", "Album"] }],
  tracklist: [{ position: "A1", title: "Side one", duration: "3:00", type_: "track" }],
  images: [{ type: "primary", uri: `https://i.discogs.com/${id}.jpg`, uri150: `https://i.discogs.com/${id}-150.jpg` }],
  // price / marketplace fields that must never come out of our API
  lowest_price: 12.34,
  num_for_sale: 7,
  community: { have: 10, want: 3 },
});

let db: AppDb;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());
beforeEach(async () => {
  vi.resetModules();
  setEnv();
  await db.delete(discogsCache);
  await db.delete(discogsBucket);
});

async function svc(answer: (id: number) => Response) {
  const service = await import("@/server/discogs/service");
  const fetchImpl = vi.fn(async (u: URL) => answer(Number(u.pathname.split("/").pop())));
  const deps = { db, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {}, random: () => 0.5 };
  return { ...service, deps, fetchImpl };
}

describe("getReleases", () => {
  it("returns trimmed card data in the order asked, without price or marketplace fields", async () => {
    const s = await svc((id) => json(release(id)));
    const r = await s.getReleases(s.deps, [3, 1, 2]);
    if (!r.ok) throw new Error("failed");
    expect(r.data.releases.map((c) => c.id)).toEqual([3, 1, 2]);
    expect(r.data.releases[0]).toEqual({
      id: 3,
      masterId: 5003,
      title: "Record 3",
      artist: "Test Artist",
      year: 1999,
      country: "Norway",
      label: "Test Label",
      catno: "TL-3",
      format: "Vinyl, LP, Album",
      thumb: expect.stringContaining("/api/discogs/image"),
      discogsUrl: "https://www.discogs.com/release/3-Record",
    });
    expect(JSON.stringify(r)).not.toMatch(/lowest_price|num_for_sale|12\.34|community|tracklist|Side one/);
    expect(r.cached).toBe(false);
  });

  it("is cached: a second call asks Discogs for nothing", async () => {
    const s = await svc((id) => json(release(id)));
    await s.getReleases(s.deps, [1, 2, 3]);
    expect(s.fetchImpl).toHaveBeenCalledTimes(3);
    const again = await s.getReleases(s.deps, [1, 2, 3]);
    expect(again.ok && again.cached).toBe(true);
    expect(s.fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("shares the cache entry with the single-release endpoint, in both directions", async () => {
    const s = await svc((id) => json(release(id)));
    await s.getRelease(s.deps, 1);
    await s.getReleases(s.deps, [1, 2]);
    expect(s.fetchImpl).toHaveBeenCalledTimes(2); // 1 (single) + 2 (batch); the batch did not re-ask for 1

    await s.getReleases(s.deps, [9]);
    const single = await s.getRelease(s.deps, 9);
    expect(single.ok && single.cached).toBe(true);
    expect(s.fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("a release Discogs no longer has is `gone` (not an error), remembered, and does not break its neighbours", async () => {
    const s = await svc((id) => (id === 404 ? json({ message: "Release not found." }, 404) : json(release(id))));
    const r = await s.getReleases(s.deps, [1, 404, 2]);
    if (!r.ok) throw new Error("failed");
    expect(r.data.releases.map((c) => c.id)).toEqual([1, 2]);
    expect(r.data.gone).toEqual([404]);
    expect(r.data.missing).toEqual([]);

    await s.getReleases(s.deps, [404]);
    expect(s.fetchImpl.mock.calls.filter((c) => (c as unknown as [URL])[0].pathname.endsWith("/404"))).toHaveLength(1);
  });

  it("when Discogs asks us to slow down, returns what it has, lists the rest as `missing` with a retryAfter", async () => {
    const s = await svc((id) => (id > 2 ? json({ message: "You are making requests too quickly." }, 429) : json(release(id))));
    const r = await s.getReleases(s.deps, [1, 2, 3, 4, 5, 6, 7, 8]);
    if (!r.ok) throw new Error("failed");
    expect(r.data.releases.map((c) => c.id).sort()).toEqual([1, 2]);
    expect(r.data.missing.sort()).toEqual([3, 4, 5, 6, 7, 8]);
    expect(r.data.retryAfter).toBeGreaterThan(0);
    expect(s.fetchImpl.mock.calls.length).toBeLessThan(8); // it stopped launching new requests
  });

  it("is bounded: at most 24 releases per call, each asked once, duplicates collapsed", async () => {
    const s = await svc((id) => json(release(id)));
    const wanted = Array.from({ length: 40 }, (_, i) => 100 + i);
    const r = await s.getReleases(s.deps, [...wanted, 100, 101]);
    if (!r.ok) throw new Error("failed");
    expect(r.data.releases).toHaveLength(24);
    expect(s.fetchImpl).toHaveBeenCalledTimes(24);
  });

  it("with no credentials and nothing cached it says so", async () => {
    setEnv({ DISCOGS_TOKEN: "", DISCOGS_CONSUMER_KEY: "", DISCOGS_CONSUMER_SECRET: "" });
    vi.resetModules();
    const s = await svc((id) => json(release(id)));
    const r = await s.getReleases(s.deps, [1]);
    expect(r).toMatchObject({ ok: false, error: "unconfigured" });
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });
});

describe("releaseIdsSchema", () => {
  it("accepts 1 to 24 distinct numeric ids and nothing else", async () => {
    vi.resetModules();
    setEnv();
    const { releaseIdsSchema } = await import("@/server/discogs/http");
    expect(releaseIdsSchema.parse("1,2,2,3")).toEqual([1, 2, 3]);
    const twentyFour = Array.from({ length: 24 }, (_, i) => i + 1).join(",");
    expect(releaseIdsSchema.safeParse(twentyFour).success).toBe(true);
    expect(releaseIdsSchema.safeParse(twentyFour + ",25").success).toBe(false);
    for (const bad of ["", "0", "-1", "1,", ",1", "1;2", "abc", "1,2,x", "01", "12345678901", "1 2"]) {
      expect(releaseIdsSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});
