import { describe, expect, it } from "vitest";
import { groupByArtist, mergeGroups } from "@/lib/discogs/group";
import {
  artistKey,
  normalizeFacets,
  normalizeRelease,
  normalizeSearchResponse,
  normalizeVersionsResponse,
  searchParamsFor,
  splitArtistTitle,
} from "@/lib/discogs/normalize";
import { releasePayload, searchPage1, searchPage2, versionsPage } from "../fixtures/discogs";

// Identity-ish mapper: lets us see which URLs survive; real allow-listing is tested in discogs-image.test.ts.
const image = (u: string | null | undefined) => (u && u.includes("i.discogs.com") ? `/proxy?u=${u}` : null);

const MARKETPLACE_KEYS = ["lowest_price", "num_for_sale", "price", "estimated_weight", "blocked_from_sale", "community", "stats"];

describe("splitArtistTitle / artistKey", () => {
  it("splits on the first ' - ' only", () => {
    expect(splitArtistTitle("Cobalt Parade - Glass Harbor")).toEqual({ artist: "Cobalt Parade", title: "Glass Harbor" });
    expect(splitArtistTitle("A - B - C")).toEqual({ artist: "A", title: "B - C" });
    expect(splitArtistTitle("Untitled Mystery")).toEqual({ artist: null, title: "Untitled Mystery" });
  });

  it("normalises case, diacritics and spacing but keeps Discogs' '(2)' disambiguation", () => {
    expect(artistKey("Beyoncé")).toBe(artistKey("BEYONCE"));
    expect(artistKey("  Daft   Punk ")).toBe("cobalt parade");
    expect(artistKey("Nirvana (2)")).not.toBe(artistKey("Nirvana"));
    expect(artistKey(null)).toBe("");
  });
});

describe("normalizeSearchResponse + groupByArtist", () => {
  const r = normalizeSearchResponse(searchPage1, image);
  const groups = groupByArtist(r.entries);

  it("drops unusable hits and counts them", () => {
    expect(r.dropped).toBe(2); // the "x"/artist hit and null
    expect(r.entries).toHaveLength(7);
  });

  it("reads pagination", () => {
    expect(r).toMatchObject({ page: 1, pages: 3, perPage: 50, totalItems: 120 });
  });

  it("groups by artist in relevance order, folding case differences", () => {
    expect(groups.map((g) => g.artist)).toEqual(["Cobalt Parade", "Some Band", null]);
    expect(groups[0].entries.map((e) => e.title)).toEqual(["Glass Harbor", "Paper Tide"]);
  });

  it("collapses releases that share a master into ONE entry and prefers the master's own data", () => {
    const discovery = groups[0].entries[0];
    expect(discovery).toMatchObject({ key: "m:500", kind: "master", id: 500, mergedHits: 3, year: 2001 });
    expect(discovery.discogsUrl).toBe("https://www.discogs.com/master/500-Glass-Harbor");
    expect(discovery.thumb).toBe("/proxy?u=https://i.discogs.com/aaa/master500.jpg");
  });

  it("treats master_id = 0 as a standalone item and dedupes it by release id", () => {
    const standalone = groups[1].entries;
    expect(standalone).toHaveLength(1);
    expect(standalone[0]).toMatchObject({ key: "r:2001", kind: "release", id: 2001, mergedHits: 2 });
    expect(standalone[0].discogsUrl).toBe("https://www.discogs.com/release/2001-Rare-Single");
  });

  it("keeps results whose artist cannot be parsed in their own group", () => {
    expect(groups[2]).toMatchObject({ key: "", artist: null });
    expect(groups[2].entries[0].title).toBe("Untitled Mystery");
  });

  it("never lets a non-allowed or placeholder image through", () => {
    const homework = groups[0].entries[1];
    expect(homework.thumb).toBeNull(); // st.discogs.com spacer
  });

  it("carries NO price or marketplace fields", () => {
    const json = JSON.stringify(groups);
    for (const k of MARKETPLACE_KEYS) expect(json).not.toContain(k);
    expect(json).not.toContain("42.5");
    expect(json).not.toContain("9.99");
  });
});

describe("mergeGroups (load more)", () => {
  it("merges page 2 into page 1, re-deduping a master that appears again", () => {
    const p1 = groupByArtist(normalizeSearchResponse(searchPage1, image).entries);
    const p2 = groupByArtist(normalizeSearchResponse(searchPage2, image).entries);
    const merged = mergeGroups(p1, p2);

    const daft = merged.find((g) => g.artist === "Cobalt Parade")!;
    expect(daft.entries.map((e) => e.key)).toEqual(["m:500", "m:600", "m:700"]);
    expect(daft.entries[0].mergedHits).toBe(4); // 3 from page 1 + 1 from page 2
    expect(merged.map((g) => g.artist)).toEqual(["Cobalt Parade", "Some Band", null]);
  });
});

describe("normalizeVersionsResponse", () => {
  const r = normalizeVersionsResponse(versionsPage, image);

  it("dedupes by id and keeps only whitelisted fields", () => {
    expect(r.versions.map((v) => v.id)).toEqual([11, 12, 13]);
    expect(r.versions[0]).toMatchObject({
      title: "Glass Harbor",
      label: "Virgin",
      catno: "V 2975",
      country: "UK",
      released: "2001",
      discogsUrl: "https://www.discogs.com/release/11",
    });
    expect(r.versions[0].formats).toEqual(["2xLP", "Album", "Vinyl"]);
    const json = JSON.stringify(r);
    for (const k of MARKETPLACE_KEYS) expect(json).not.toContain(k);
  });
});

describe("normalizeFacets", () => {
  it("keeps country, year and label options, sorted, ignoring other facets and bad values", () => {
    const f = normalizeVersionsResponse(versionsPage, image).facets;
    expect(f.country).toEqual([{ value: "France", count: 1 }, { value: "Japan", count: 1 }, { value: "UK", count: 1 }]);
    expect(f.released).toEqual([{ value: "2001", count: 2 }, { value: "2002", count: 1 }]);
    expect(f.label.map((x) => x.value)).toEqual(["Victor", "Virgin"]);
    expect(JSON.stringify(f)).not.toContain("CD"); // the format facet is not one of ours
  });

  it("is empty when Discogs sends none", () => {
    expect(normalizeFacets(undefined)).toEqual({ country: [], released: [], label: [] });
    expect(normalizeFacets([{ id: "country", values: [null, { value: "" }, { value: "UK", count: "x" }] }]).country).toEqual([{ value: "UK", count: 0 }]);
  });
});

describe("normalizeRelease", () => {
  const rel = normalizeRelease(releasePayload, image)!;

  it("maps the fields we need", () => {
    expect(rel).toMatchObject({
      id: 1001,
      masterId: 500,
      title: "Glass Harbor",
      artist: "Cobalt Parade",
      year: 2001,
      country: "Europe",
      genres: ["Electronic"],
      styles: ["House", "Disco"],
      discogsUrl: "https://www.discogs.com/release/1001-Glass-Harbor",
    });
    expect(rel.formats).toEqual([{ name: "Vinyl", qty: 2, descriptions: ["LP", "Album"] }]);
    expect(rel.tracklist[0]).toEqual({ position: "A1", title: "Slow Orbit", duration: "5:20", type: "track" });
  });

  it("uses the primary image, proxied", () => {
    expect(rel.cover).toBe("/proxy?u=https://i.discogs.com/img/primary.jpg");
    expect(rel.thumb).toBe("/proxy?u=https://i.discogs.com/img/primary150.jpg");
  });

  it("keeps only identifiers that help tell pressings apart", () => {
    expect(rel.identifiers).toEqual([
      { type: "Barcode", value: "724384960650" },
      { type: "Matrix / Runout", value: "VIRGIN V2975 A1" },
    ]);
  });

  it("strips price and marketplace data", () => {
    const json = JSON.stringify(rel);
    for (const k of MARKETPLACE_KEYS) expect(json).not.toContain(k);
    expect(json).not.toContain("42.5");
    expect(json).not.toContain("460");
  });

  it("treats master_id 0 as no master and rejects garbage", () => {
    expect(normalizeRelease({ ...releasePayload, master_id: 0 }, image)!.masterId).toBeNull();
    expect(normalizeRelease({ nope: true }, image)).toBeNull();
    expect(normalizeRelease(null, image)).toBeNull();
  });
});

describe("searchParamsFor", () => {
  it("maps each mode to Discogs parameters", () => {
    expect(searchParamsFor("track", "slow orbit")).toEqual({ track: "slow orbit", type: "release" });
    expect(searchParamsFor("artist", "cobalt parade")).toEqual({ artist: "cobalt parade", type: "master" });
    expect(searchParamsFor("master", "discovery")).toEqual({ q: "discovery", type: "master" });
  });
});
