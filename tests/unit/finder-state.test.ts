import { describe, expect, it } from "vitest";
import { MAX_SEARCH_PAGES as SERVER_SEARCH_PAGES, MAX_VERSION_PAGES as SERVER_VERSION_PAGES } from "@/server/discogs/config";
import {
  albumsBackQuery,
  artistsBackQuery,
  contextQuery,
  finderQuery,
  MAX_ALBUM_VIEWS,
  MAX_SEARCH_PAGES,
  MAX_VERSION_PAGES,
  masterQuery,
  parseFinder,
  parseMaster,
} from "@/lib/finder-state";

const sp = (qs: string) => new URLSearchParams(qs);

describe("finder state in the URL: parsing", () => {
  it("reads a full address", () => {
    expect(parseFinder(sp("mode=track&q=ultraviolence&by=Lana del Rey&g=lana del rey&n=2&sp=3&o=1"))).toEqual({
      mode: "track",
      q: "ultraviolence",
      by: "Lana del Rey",
      g: "lana del rey",
      views: 2,
      searchPages: 3,
      othersOpen: true,
    });
  });

  it("an empty address is the plain search start", () => {
    expect(parseFinder(sp(""))).toEqual({ mode: "track", q: "", by: "", g: null, views: 1, searchPages: 1, othersOpen: false });
    expect(finderQuery(parseFinder(sp("")))).toEqual({});
  });

  it("falls back safely on invalid or tampered values", () => {
    const s = parseFinder(sp("mode=<script>&q=%00%01hello%0Aworld&by=x&g=&n=-5&sp=abc&o=yes"));
    expect(s.mode).toBe("track"); // unknown mode
    expect(s.q).toBe("hello world"); // control characters are blanked, not passed on
    expect(s.g).toBeNull(); // empty -> artist list
    expect(s.views).toBe(1); // negative
    expect(s.searchPages).toBe(1); // not a number
    expect(s.othersOpen).toBe(false); // only "1" opens it
  });

  it("clamps counters so a hand-made address cannot fan out requests", () => {
    expect(parseFinder(sp("q=a&n=999&sp=999")).views).toBe(MAX_ALBUM_VIEWS);
    expect(parseFinder(sp("q=a&n=999&sp=999")).searchPages).toBe(MAX_SEARCH_PAGES);
    expect(parseFinder(sp("q=a&n=0&sp=0"))).toMatchObject({ views: 1, searchPages: 1 });
    expect(parseFinder(sp("q=a&n=1e9&sp=2.5"))).toMatchObject({ views: 1, searchPages: 1 }); // not plain digits
    expect(parseFinder(sp("q=a&n=99999999999")).views).toBe(1); // too long to be a plain small number
    expect(parseMaster(sp("vp=999")).versionPages).toBe(MAX_VERSION_PAGES);
  });

  it("limits text length and trims", () => {
    const s = parseFinder(sp(`q=${"x".repeat(500)}&by=${"y".repeat(500)}&g=${"z".repeat(500)}`));
    expect(s.q).toHaveLength(100);
    expect(s.by).toHaveLength(100);
    expect(s.g).toHaveLength(200);
    expect(parseFinder(sp("q=%20%20spaced%20%20")).q).toBe("spaced");
  });

  it("the artist field does not exist in artist mode, even if the address has one", () => {
    expect(parseFinder(sp("mode=artist&q=lana&by=ignored")).by).toBe("");
  });

  it("the server's page limits and ours are the same numbers", () => {
    expect(MAX_SEARCH_PAGES).toBe(SERVER_SEARCH_PAGES);
    expect(MAX_VERSION_PAGES).toBe(SERVER_VERSION_PAGES);
  });

  it("master step: reads the heading context and the filters; blank filters are dropped", () => {
    expect(parseMaster(sp("a=Cobalt Parade&t=Glass Harbor&country=Japan&released=2002&label=Victor&vp=2"))).toEqual({
      a: "Cobalt Parade",
      t: "Glass Harbor",
      country: "Japan",
      released: "2002",
      label: "Victor",
      versionPages: 2,
    });
    expect(parseMaster(sp("country=&label=%20"))).toEqual({ a: null, t: null, country: undefined, released: undefined, label: undefined, versionPages: 1 });
  });
});

describe("finder state in the URL: building", () => {
  const full = parseFinder(sp("mode=album&q=glass&by=Cobalt&g=cobalt parade&n=3&sp=2&o=1"));

  it("round-trips: parse(build(state)) is the same state", () => {
    expect(parseFinder(new URLSearchParams(finderQuery(full)))).toEqual(full);
    const m = parseMaster(sp("a=A&t=T&country=UK&released=2001&label=Virgin&vp=3"));
    expect(parseMaster(new URLSearchParams(masterQuery(m)))).toEqual(m);
  });

  it("leaves defaults out", () => {
    expect(finderQuery(parseFinder(sp("mode=track&q=abc")))).toEqual({ mode: "track", q: "abc" });
    // album counters only mean something once an artist is chosen
    expect(finderQuery({ ...full, g: null })).toEqual({ mode: "album", q: "glass", by: "Cobalt", sp: "2" });
  });

  it("Back to albums keeps the query, the artist, the albums shown and the loaded pages", () => {
    expect(albumsBackQuery(full, { a: "Cobalt Parade" })).toEqual({ mode: "album", q: "glass", by: "Cobalt", g: "cobalt parade", n: "3", sp: "2", o: "1" });
  });

  it("an old link with no artist key falls back to the artist's name from the heading", () => {
    const s = parseFinder(sp("mode=track&q=ultraviolence&by=Lana del Rey"));
    expect(albumsBackQuery(s, { a: "Lana Del Rey" })).toEqual({ mode: "track", q: "ultraviolence", by: "Lana del Rey", g: "lana del rey" });
    expect(albumsBackQuery(s, { a: null })).toEqual({ mode: "track", q: "ultraviolence", by: "Lana del Rey" }); // artist list
  });

  it("with no search at all, Back has nothing to rebuild", () => {
    expect(albumsBackQuery(parseFinder(sp("")), { a: "X" })).toEqual({});
  });

  it("Choose another artist drops the artist-level state and keeps the loaded pages", () => {
    expect(artistsBackQuery(full)).toEqual({ mode: "album", q: "glass", by: "Cobalt", sp: "2" });
  });

  it("the release card carries everything the pressings page needs", () => {
    const m = parseMaster(sp("a=Cobalt Parade&t=Glass Harbor&country=Japan&vp=2"));
    expect(contextQuery(full, m)).toEqual({
      mode: "album",
      q: "glass",
      by: "Cobalt",
      g: "cobalt parade",
      n: "3",
      sp: "2",
      o: "1",
      a: "Cobalt Parade",
      t: "Glass Harbor",
      country: "Japan",
      vp: "2",
    });
  });
});
