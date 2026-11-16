import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { discogsBucket, discogsCache } from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";
import { createTestDb } from "../helpers/pglite";
import { setEnv } from "../helpers/env";

/**
 * Regression tests for the "neon static" bug, driven by RECORDED REAL Discogs responses (tests/fixtures/real, recorded
 * 2026-11-16, trimmed to CC0 fields). The bug: the album's vinyl master was missing and a CD-only single was shown, because
 * no vinyl filter was applied and masters were described by one release's data.
 */

const real = (name: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, `../fixtures/real/${name}.json`), "utf8"));
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const NON_VINYL = /^(CD|CDr|File|MP3|FLAC|WAV|AAC|Cassette|DVD)$/i;

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

async function svc(...responses: unknown[]) {
  const service = await import("@/server/discogs/service");
  const queue = responses.map((r) => (r instanceof Response ? r : json(r)));
  const fetchImpl = vi.fn(async () => {
    const r = queue.shift();
    if (!r) throw new Error("no more responses");
    return r;
  });
  const deps = { db, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {}, random: () => 0.5 };
  const lastParams = () => Object.fromEntries((fetchImpl.mock.calls.at(-1) as unknown as [URL])[0].searchParams);
  const urls = () => fetchImpl.mock.calls.map((c) => (c as unknown as [URL])[0]);
  return { ...service, deps, fetchImpl, lastParams, urls };
}

const allEntries = (groups: Array<{ entries: Array<{ formats: string[]; key: string }> }>) => groups.flatMap((g) => g.entries);
const expectAllVinyl = (groups: Parameters<typeof allEntries>[0]) => {
  for (const e of allEntries(groups)) {
    // The rule is "includes vinyl". (A real LP + CD set, e.g. "Vinyl, LP, Album, CD, Album", stays: it has vinyl.)
    expect(e.formats.map((f) => f.toLowerCase()), e.key).toContain("vinyl");
  }
};

/** For the Mira Vale cases the recorded vinyl releases are pure vinyl, so no CD / file token may appear at all. */
const expectPureVinyl = (groups: Parameters<typeof allEntries>[0]) => {
  for (const e of allEntries(groups)) for (const f of e.formats) expect(f, `${e.key} must not list a CD / file format`).not.toMatch(NON_VINYL);
};

describe("(a) 'neon static' surfaces the album's vinyl master and never a CD-only item", () => {
  it("asks Discogs for VINYL RELEASES narrowed by artist, with the exact recorded parameters", async () => {
    const recorded = real("search-neon static-track-lana-vinyl");
    const s = await svc(recorded);
    await s.searchDiscogs(s.deps, { mode: "track", query: "neon static", by: "Mira Vale", page: 1 });
    const { per_page: _perPage, page: _page, ...asked } = s.lastParams();
    // the parameters that were recorded from the real API are exactly the ones we send now (page size and page aside)
    const { per_page: _rp, page: _rg, ...wanted } = recorded._recorded.params;
    expect(asked).toEqual(wanted);
    expect(wanted).toEqual({ track: "neon static", artist: "Mira Vale", type: "release", format: "Vinyl" });
    expect(s.urls()[0].pathname).toBe("/database/search");
  });

  it("returns the album master 'Neon Static' (910001) with its vinyl formats, plus the single's master", async () => {
    const s = await svc(real("search-neon static-track-lana-vinyl"));
    const r = await s.searchDiscogs(s.deps, { mode: "track", query: "neon static", by: "Mira Vale", page: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lana = r.data.groups.find((g) => g.artist === "Mira Vale")!;
    expect(lana).toBeDefined();

    const album = lana.entries.find((e) => e.key === "m:910001")!;
    expect(album, "the album master must be present").toBeDefined();
    expect(album).toMatchObject({ kind: "master", id: 910001 });
    expect(album.formats).toEqual(expect.arrayContaining(["Vinyl", "LP", "Album"]));
    expect(album.mergedHits).toBeGreaterThan(5); // many vinyl pressings were found for it

    const masters = lana.entries.filter((e) => e.kind === "master").map((e) => e.id).sort((a, b) => a - b);
    expect(masters).toEqual([910001, 910002, 910003, 910004]); // exactly what the recorded response contains
  });

  it("shows NO CD, CDr or file item anywhere", async () => {
    const s = await svc(real("search-neon static-track-lana-vinyl"));
    const r = await s.searchDiscogs(s.deps, { mode: "track", query: "neon static", by: "Mira Vale", page: 1 });
    if (!r.ok) throw new Error("search failed");
    expectAllVinyl(r.data.groups);
    expectPureVinyl(r.data.groups);
    expect(JSON.stringify(r.data.groups)).not.toMatch(/"CDr?"|"File"|"MP3"|"Promo"/); // the old card said "CDr, Single, Promo"
  });

  it("also finds the album when only the track is typed (no artist)", async () => {
    const s = await svc(real("search-neon static-track-vinyl"));
    const r = await s.searchDiscogs(s.deps, { mode: "track", query: "neon static", page: 1 });
    expect(s.lastParams()).not.toHaveProperty("artist");
    expect(s.lastParams()).toMatchObject({ type: "release", format: "Vinyl", track: "neon static" });
    if (!r.ok) throw new Error("search failed");
    expectAllVinyl(r.data.groups);
    const lana = r.data.groups.find((g) => g.artist === "Mira Vale")!;
    expect(lana.entries.map((e) => e.key)).toContain("m:910001");
  });

  it("even if Discogs did send CD-only items (the OLD unfiltered response), none of them is shown", async () => {
    const old = real("search-neon static-track-unfiltered");
    const nonVinyl = old.results.filter((x: { format?: string[] }) => !x.format?.some((f) => f.toLowerCase() === "vinyl")).length;
    expect(nonVinyl).toBeGreaterThan(30); // the recorded page really was mostly CD / files

    const s = await svc(old);
    const r = await s.searchDiscogs(s.deps, { mode: "track", query: "neon static", page: 1 });
    if (!r.ok) throw new Error("search failed");
    expectAllVinyl(r.data.groups);
    // the CDr promo single is gone; only the vinyl 12" remix of that master remains
    const lana = r.data.groups.find((g) => g.artist === "Mira Vale")!;
    expect(JSON.stringify(lana)).not.toContain("CDr");
    // every vinyl hit is accounted for, and not one non-vinyl hit
    const kept = allEntries(r.data.groups).reduce((n, e) => n + (e as unknown as { mergedHits: number }).mergedHits, 0);
    expect(kept).toBe(old.results.length - nonVinyl);
  });

  it("album mode: release_title + artist finds the album's vinyl releases under its master", async () => {
    const s = await svc(real("search-neon static-album-lana-vinyl"));
    const r = await s.searchDiscogs(s.deps, { mode: "album", query: "Neon Static", by: "Mira Vale", page: 1 });
    expect(s.lastParams()).toMatchObject({ type: "release", format: "Vinyl", release_title: "Neon Static", artist: "Mira Vale" });
    if (!r.ok) throw new Error("search failed");
    expectAllVinyl(r.data.groups);
    const album = allEntries(r.data.groups).find((e) => e.key === "m:910001")!;
    expect(album).toBeDefined();
  });

  it("artist mode: lists many albums of the artist, all with vinyl", async () => {
    const s = await svc(real("search-lana-artist-vinyl"));
    const r = await s.searchDiscogs(s.deps, { mode: "artist", query: "Mira Vale", by: "ignored", page: 1 });
    expect(s.lastParams()).toMatchObject({ type: "release", format: "Vinyl", artist: "Mira Vale" });
    if (!r.ok) throw new Error("search failed");
    expectAllVinyl(r.data.groups);
    expect(allEntries(r.data.groups).filter((e) => e.key.startsWith("m:")).length).toBeGreaterThan(15);
    expect(r.data.hasMore).toBe(true); // 394 vinyl releases over 8 pages
    expect(r.data.incomplete).toBe(true);
  });
});

describe("the album card's data comes from the MASTER record, not from one release", () => {
  it("resolves /masters/{id} to the album's title, year and artist, strips price fields, and caches it", async () => {
    const s = await svc(real("master-910001"));
    const r = await s.getMasters(s.deps, [910001]);
    expect(s.urls()[0].pathname).toBe("/masters/910001");
    if (!r.ok) throw new Error("failed");
    expect(r.data.masters).toEqual([
      expect.objectContaining({ id: 910001, title: "Neon Static", year: 2014, artist: "Mira Vale", discogsUrl: "https://www.discogs.com/master/910001-Lana-Del-Rey-Neon Static" }),
    ]);
    expect(r.data.missing).toEqual([]);
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/lowest_price|num_for_sale|1\.11/);
    expect(r.cached).toBe(false);

    const again = await s.getMasters(s.deps, [910001]);
    expect(again.ok && again.cached).toBe(true);
    expect(s.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("is bounded: at most 12 masters per call, each looked up once, in order", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => 1000 + i);
    const master = (id: number) => ({ id, title: `Album ${id}`, year: 2000, uri: `https://www.discogs.com/master/${id}`, artists: [{ name: "A" }] });
    const s = await svc(...ids.slice(0, 12).map(master));
    const r = await s.getMasters(s.deps, [...ids, ...ids]); // duplicates and too many
    expect(s.fetchImpl).toHaveBeenCalledTimes(12);
    expect(r.ok && r.data.masters.map((m) => m.id)).toEqual(ids.slice(0, 12));
  });

  it("when Discogs says slow down, keeps what it has, reports the rest as missing with retryAfter, and stops asking", async () => {
    const s = await svc(real("master-910001"), new Response("", { status: 429, headers: { "retry-after": "120" } }));
    const r = await s.getMasters(s.deps, [910001, 910002, 111111]);
    if (!r.ok) throw new Error("failed");
    expect(r.data.masters.map((m) => m.id)).toEqual([910001]);
    expect(r.data.missing).toEqual([910002, 111111]);
    expect(r.data.retryAfter).toBe(120);
    expect(s.fetchImpl).toHaveBeenCalledTimes(2); // the third master was NOT requested
  });

  it("serves an unknown master as missing rather than failing the batch", async () => {
    const s = await svc(new Response("", { status: 404 }), real("master-910001"));
    const r = await s.getMasters(s.deps, [999999, 910001]);
    expect(r.ok && r.data).toMatchObject({ missing: [999999] });
    expect(r.ok && r.data.masters.map((m) => m.id)).toEqual([910001]);
  });
});

describe("(b) a track that exists only on CD gives an empty result, and the screen offers the fallback", () => {
  it("the recorded vinyl search finds nothing for Lumen Choir's CD-only 'neon static'", async () => {
    const recorded = real("search-neon static-track-syncore-vinyl-EMPTY");
    expect(recorded.pagination.items).toBe(0);
    const s = await svc(recorded);
    const r = await s.searchDiscogs(s.deps, { mode: "track", query: "neon static", by: "Lumen Choir", page: 1 });
    expect(r.ok && r.data).toMatchObject({ groups: [], totalItems: 0, hasMore: false, incomplete: false, by: "Lumen Choir" });
  });

  it("and the same track WITHOUT the vinyl filter returns only CD / file releases, all dropped client-side", async () => {
    const any = real("search-neon static-track-syncore-any-format");
    expect(any.pagination.items).toBeGreaterThan(0);
    expect(any.results.every((x: { format: string[] }) => !x.format.includes("Vinyl"))).toBe(true);
    const s = await svc(any);
    const r = await s.searchDiscogs(s.deps, { mode: "track", query: "neon static", by: "Lumen Choir", page: 1 });
    expect(r.ok && r.data.groups).toEqual([]);
  });
});

describe("(c) artist + track mode ('slow orbit' by Cobalt Parade)", () => {
  it("narrows by artist, finds the vinyl masters, and shows only vinyl", async () => {
    const recorded = real("search-one-more-time-track-daft-punk-vinyl");
    const s = await svc(recorded);
    const r = await s.searchDiscogs(s.deps, { mode: "track", query: "slow orbit", by: "Cobalt Parade", page: 1 });
    expect(s.lastParams()).toMatchObject({ type: "release", format: "Vinyl", track: "slow orbit", artist: "Cobalt Parade" });
    if (!r.ok) throw new Error("search failed");
    expectAllVinyl(r.data.groups);
    const daft = r.data.groups.find((g) => g.artist === "Cobalt Parade")!;
    expect(daft).toBeDefined();
    const single = daft.entries.find((e) => e.key === "m:920001")!;
    expect(single.mergedHits).toBeGreaterThan(5);
    expect(r.data.by).toBe("Cobalt Parade");
    expect(r.data.hasMore).toBe(true);
  });

  it("the artist and the track are cached separately from the track alone", async () => {
    const s = await svc(real("search-one-more-time-track-daft-punk-vinyl"), real("search-neon static-track-vinyl"));
    await s.searchDiscogs(s.deps, { mode: "track", query: "slow orbit", by: "Cobalt Parade", page: 1 });
    await s.searchDiscogs(s.deps, { mode: "track", query: "slow orbit", page: 1 });
    expect(s.fetchImpl).toHaveBeenCalledTimes(2); // different keys, so no wrong cache hit
    await s.searchDiscogs(s.deps, { mode: "track", query: "ONE more   time", by: "cobalt parade", page: 1 });
    expect(s.fetchImpl).toHaveBeenCalledTimes(2); // normalised: served from cache
  });
});

describe("pressings of the album are vinyl only", () => {
  it("asks for format=Vinyl and shows the recorded vinyl pressings of 'Neon Static' (Box Set included)", async () => {
    const recorded = real("master-910001-versions-vinyl");
    const s = await svc(recorded);
    const r = await s.getMasterVersions(s.deps, { masterId: 910001, page: 1 });
    expect(s.lastParams()).toMatchObject({ format: "Vinyl", per_page: "50", page: "1" });
    if (!r.ok) throw new Error("failed");
    expect(r.data.versions).toHaveLength(recorded.pagination.items); // 14: nothing real was dropped
    expect(r.data.versions.map((v) => v.id)).toContain(880014); // the Box Set (it contains LPs, so Discogs keeps it)
    expect(r.data.facets.country.length).toBeGreaterThan(3);
    // Discogs sends facet values form-encoded; the filter UI needs the readable text (and sends it plain).
    const countries = r.data.facets.country.map((f) => f.value);
    expect(countries).toContain("Germany, Austria, & Switzerland");
    expect(r.data.facets.label.map((f) => f.value)).toContain("Polydor Ltd. (Uk)");
    for (const f of [...r.data.facets.country, ...r.data.facets.label]) expect(f.value, "no form-encoding left").not.toMatch(/%[0-9A-F]{2}|\+/);
  });

  it("drops a CD-only row if Discogs ever sends one", async () => {
    const recorded = real("master-910001-versions-vinyl");
    recorded.versions.push({ id: 1, title: "Neon Static", label: "Polydor", catno: "X", country: "UK", released: "2014", format: "CD, Album", major_formats: ["CD"] });
    const s = await svc(recorded);
    const r = await s.getMasterVersions(s.deps, { masterId: 910001, page: 1 });
    expect(r.ok && r.data.versions.some((v) => v.id === 1)).toBe(false);
  });

  it("uses a separate cache row per medium: vinyl pressings are never mixed with an older unfiltered list", async () => {
    const { cacheKey } = await import("@/server/discogs/cache");
    const s = await svc(real("master-910001-versions-vinyl"));
    await s.getMasterVersions(s.deps, { masterId: 910001, page: 1 });
    const [row] = await db.select().from(discogsCache);
    expect(row.key).toBe(cacheKey("https://api.discogs.com", "versions", { master: 910001, page: 1, per_page: 50, format: "Vinyl" }));
    expect(row.key).toMatch(/^v2\|/);
  });
});
