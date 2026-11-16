import { describe, expect, it } from "vitest";
import { groupByArtist, mergeGroups } from "@/lib/discogs/group";
import {
  artistKey,
  normalizeFacets,
  normalizeMaster,
  normalizeRelease,
  normalizeSearchResponse,
  normalizeVersionsResponse,
  searchParamsFor,
  splitArtistTitle,
} from "@/lib/discogs/normalize";
import { masterPayloads, releasePayload, searchPage1, searchPage2, versionsPage } from "../fixtures/discogs";

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

describe("normalizeSearchResponse + groupByArtist (vinyl releases grouped by master)", () => {
  const r = normalizeSearchResponse(searchPage1, image);
  const groups = groupByArtist(r.entries);

  it("drops unusable hits AND non-vinyl hits, and counts them", () => {
    expect(r.dropped).toBe(3); // the "x"/artist hit, null, and the CD (id 1004)
    expect(r.entries).toHaveLength(6);
    for (const e of r.entries) expect(e.formats.map((f) => f.toLowerCase())).toContain("vinyl");
  });

  it("reads pagination", () => {
    expect(r).toMatchObject({ page: 1, pages: 3, perPage: 50, totalItems: 120 });
  });

  it("groups by artist in relevance order, folding case differences", () => {
    expect(groups.map((g) => g.artist)).toEqual(["Cobalt Parade", "Some Band", null]);
    expect(groups[0].entries.map((e) => e.key)).toEqual(["m:500", "m:600"]);
  });

  it("collapses the VINYL releases of one master into ONE entry (the CD of that master is not counted)", () => {
    const discovery = groups[0].entries[0];
    expect(discovery).toMatchObject({ key: "m:500", kind: "master", id: 500, mergedHits: 2, year: 2001 });
    expect(discovery.formats).toEqual(["Vinyl", "LP", "Album", "Reissue"]); // union of the vinyl releases, never "CD"
    expect(discovery.discogsUrl).toBe("https://www.discogs.com/master/500");
    expect(discovery.thumb).toBe("/proxy?u=https://i.discogs.com/aaa/thumb1.jpg");
  });

  it("keeps a release's own title only as a FALLBACK: the album title comes from the master record later", () => {
    // The first hit is a remix. This is the real failure mode (Mira Vale - Neon Static): the entry's title is a
    // release's, so the UI resolves /masters/{id} for the real one.
    expect(groups[0].entries[0].title).toBe("Glass Harbor (Remixes)");
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
  });
});

describe("mergeGroups (load more)", () => {
  it("merges page 2 into page 1, re-deduping a master that appears again", () => {
    const p1 = groupByArtist(normalizeSearchResponse(searchPage1, image).entries);
    const p2 = groupByArtist(normalizeSearchResponse(searchPage2, image).entries);
    const merged = mergeGroups(p1, p2);

    const daft = merged.find((g) => g.artist === "Cobalt Parade")!;
    expect(daft.entries.map((e) => e.key)).toEqual(["m:500", "m:600", "m:700"]);
    expect(daft.entries[0].mergedHits).toBe(3); // 2 vinyl releases from page 1 + 1 from page 2
    expect(merged.map((g) => g.artist)).toEqual(["Cobalt Parade", "Some Band", null]);
  });
});

describe("normalizeMaster", () => {
  it("takes the album's own title, year, artist and cover, and nothing from the price fields", () => {
    const m = normalizeMaster(masterPayloads[500], image)!;
    expect(m).toEqual({
      id: 500,
      title: "Glass Harbor",
      artist: "Cobalt Parade",
      year: 2001,
      thumb: "/proxy?u=https://i.discogs.com/m/500.jpg",
      discogsUrl: "https://www.discogs.com/master/500-Cobalt-Parade-Glass-Harbor",
    });
    const json = JSON.stringify(m);
    for (const k of MARKETPLACE_KEYS) expect(json).not.toContain(k);
    expect(json).not.toContain("9.99");
  });

  it("copes with a master that has no image or an unknown year, and rejects garbage", () => {
    expect(normalizeMaster({ ...masterPayloads[700], year: 0 }, image)).toMatchObject({ thumb: null, year: null });
    expect(normalizeMaster({ title: "x" }, image)).toBeNull();
    expect(normalizeMaster(null, image)).toBeNull();
  });
});

describe("normalizeVersionsResponse", () => {
  const r = normalizeVersionsResponse(versionsPage, image);

  it("dedupes by id and keeps only whitelisted fields", () => {
    expect(r.versions.map((v) => v.id)).toEqual([11, 13, 14]); // the CD (12) is dropped
    expect(r.versions[0]).toMatchObject({
      title: "Glass Harbor",
      label: "Virgin",
      catno: "V 2975",
      country: "UK",
      released: "2001",
      discogsUrl: "https://www.discogs.com/release/11",
    });
    expect(r.versions[0].formats).toEqual(["Vinyl", "2xLP", "Album"]); // medium first
    const json = JSON.stringify(r);
    for (const k of MARKETPLACE_KEYS) expect(json).not.toContain(k);
  });
});

describe("normalizeFacets", () => {
  it("keeps country, year and label options, sorted, ignoring other facets and bad values", () => {
    const f = normalizeVersionsResponse(versionsPage, image).facets;
    expect(f.country).toEqual([{ value: "Japan", count: 1 }, { value: "UK", count: 1 }, { value: "US", count: 1 }]);
    expect(f.released).toEqual([{ value: "2001", count: 2 }, { value: "2002", count: 1 }]);
    expect(f.label.map((x) => x.value)).toEqual(["Victor", "Virgin"]);
    expect(JSON.stringify(f)).not.toContain("Vinyl"); // the format facet is not one of ours
  });

  it("decodes form-encoded values ('+' = space, %XX) and tolerates malformed ones", () => {
    const f = normalizeFacets([{ id: "label", values: [{ value: "Polydor+Ltd.+%28Uk%29", title: "Polydor Ltd. (Uk)", count: 2 }, { value: "100%", title: "Odd", count: 1 }] }]);
    expect(f.label.map((x) => x.value)).toEqual(["100%", "Polydor Ltd. (Uk)"]); // "100%" is not valid encoding: kept as is
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

describe("searchParamsFor: always vinyl RELEASES", () => {
  it("maps each mode to Discogs parameters, with type=release and format=Vinyl", () => {
    expect(searchParamsFor("track", "slow orbit")).toEqual({ type: "release", format: "Vinyl", track: "slow orbit" });
    expect(searchParamsFor("artist", "cobalt parade")).toEqual({ type: "release", format: "Vinyl", artist: "cobalt parade" });
    expect(searchParamsFor("album", "discovery")).toEqual({ type: "release", format: "Vinyl", release_title: "discovery" });
  });

  it("narrows a track or album search to an artist, but never an artist search", () => {
    expect(searchParamsFor("track", "neon static", "Mira Vale")).toEqual({ type: "release", format: "Vinyl", track: "neon static", artist: "Mira Vale" });
    expect(searchParamsFor("album", "neon static", "Mira Vale")).toMatchObject({ release_title: "neon static", artist: "Mira Vale" });
    expect(searchParamsFor("artist", "Mira Vale", "Someone Else")).toEqual({ type: "release", format: "Vinyl", artist: "Mira Vale" });
    expect(searchParamsFor("track", "x", "")).not.toHaveProperty("artist");
  });

  it("never searches masters (a master's format is its main release's, so the medium cannot be filtered there)", () => {
    for (const mode of ["track", "artist", "album"] as const) expect(searchParamsFor(mode, "x").type).toBe("release");
  });
});
