/**
 * SYNTHETIC Discogs-shaped responses for the vinyl-search regression tests. Every artist, title, id, year, format combination
 * and country below is INVENTED; only the SHAPE of the responses (fields, pagination, how masters and releases relate, how
 * facets are encoded) mirrors the real API. Real recordings are kept out of git (see .gitignore, tests/fixtures/_local-recordings).
 *
 * The scenario mirrors a bug found on the real API: a popular track exists as a SINGLE and on an ALBUM by the same artist.
 * An unfiltered release search listed CD / digital releases of the single and not the album's vinyl pressings.
 *
 *   artist "Mira Vale", track "Neon Static"
 *     master 910001  "Static Bloom"  (the ALBUM, many vinyl pressings, its main release is digital)
 *     master 910002  "Neon Static"   (the SINGLE: CDr promo, files, one 12" remix on vinyl)
 */

export interface Hit {
  id: number;
  type: "release";
  master_id: number;
  title: string;
  year?: string;
  format: string[];
  country?: string;
}

const pagination = (page: number, pages: number, items: number) => ({ page, pages, per_page: 50, items });
const search = (hits: Hit[], p: { page?: number; pages: number; items: number }) => ({ pagination: pagination(p.page ?? 1, p.pages, p.items), results: hits });
const COUNTRIES = ["US", "UK", "Germany", "France", "Japan", "Europe", "Worldwide", "Canada"];
const cycle = <T,>(list: T[], i: number) => list[i % list.length];

let nextId = 7_000_000;
const hit = (master: number, artist: string, title: string, format: string[], year: number | null, i = 0): Hit => ({
  id: nextId++,
  type: "release",
  master_id: master,
  title: `${artist} - ${title}`,
  ...(year ? { year: String(year) } : {}),
  format,
  country: cycle(COUNTRIES, i),
});

// ---------------------------------------------------------------------------------------------------------------------------
// 1. The OLD query (no vinyl filter): a mixed page. 640 hits over 13 pages; 40 of the 50 on page 1 are not vinyl.
export const unfilteredTrackSearch = () => {
  nextId = 7_100_000;
  const single: Hit[] = [
    hit(910002, "Mira Vale", "Neon Static", ["CDr", "Single", "Promo"], 2014, 0),
    hit(910002, "Mira Vale", "Neon Static", ["CDr", "Single", "Promo"], 2014, 1),
    hit(910002, "Mira Vale", "Neon Static (Glasshouse Remix)", ["File", "FLAC", "Single"], 2014, 2),
    hit(910002, "Mira Vale", "Neon Static (Tide Remix)", ["File", "WAV", "Single"], 2014, 3),
    hit(910002, "Mira Vale", "Neon Static (Orbit Remix)", ["File", "WAV", "Single"], 2014, 4),
    hit(910002, "Mira Vale", "Neon Static (Lark Remix)", ["File", "WAV", "Single", "Unofficial Release"], 2014, 5),
    hit(910002, "Mira Vale", "Neon Static (Tide Remix)", ["Vinyl", '12"', "45 RPM", "Single Sided", "Single", "Limited Edition"], 2014, 6),
    hit(910002, "Mira Vale", "Neon Static (Glasshouse Remix)", ["File", "WAV", "Single"], 2014, 7),
    hit(910002, "Mira Vale", "Neon Static (Glasshouse Remix)", ["File", "MP3", "Single"], 2014, 8),
  ];
  const others: Hit[] = [];
  const artists = ["Cobalt Parade", "Lumen Choir", "The Quiet Orchard", "Saffron Line", "Dune Registry", "Paper Lantern"];
  for (let i = 0; i < 41; i++) {
    const vinyl = i < 10;
    others.push(
      hit(i % 5 === 0 ? 0 : 940000 + (i % 13), cycle(artists, i), "Neon Static", vinyl ? ["Vinyl", '12"'] : cycle([["CD", "Single"], ["File", "MP3", "Single"], ["CD", "Promo"], ["File", "FLAC"]], i), 2000 + (i % 20), i),
    );
  }
  return {
    params: { track: "neon static", type: "release", per_page: "50", page: "1" },
    response: search([...others.slice(0, 20), ...single, ...others.slice(20)], { pages: 13, items: 640 }),
  };
};

// 2. The FIX, narrowed by artist: 21 hits, ALL vinyl, four masters (the album among them) and two standalone releases.
export const trackByArtistVinyl = () => {
  nextId = 7_200_000;
  const albumFormats = [
    ["Vinyl", "LP", "Album"],
    ["Vinyl", "LP", "Album", "Reissue"],
    ["Vinyl", "LP", "Album", "Stereo"],
    ["Vinyl", "LP", "Album", "Deluxe Edition"],
    ["Vinyl", "LP", "Test Pressing", "Stereo"],
    ["Vinyl", "LP", "Album", "White Label"],
  ];
  const hits: Hit[] = [
    hit(910002, "Mira Vale", "Neon Static (Tide Remix)", ["Vinyl", '12"', "45 RPM", "Single Sided", "Single", "Limited Edition"], 2014, 0),
    ...Array.from({ length: 16 }, (_, i) => hit(910001, "Mira Vale", "Static Bloom", cycle(albumFormats, i), 2014 + (i % 4), i)),
    hit(910003, "Mira Vale", "Live At The Harbor", ["Vinyl", "LP", "Unofficial Release"], 2025, 1),
    hit(910004, "Mira Vale", "Glass Tour: Over And Under", ["Vinyl", "LP", "Unofficial Release"], 2024, 2),
    hit(0, "Mira Vale", "Greatest Static", ["Vinyl", "LP", "Compilation", "Unofficial Release"], 2024, 3),
    hit(0, "Mira Vale", "Static Bloom: Volume II", ["Vinyl", "LP", "Compilation", "Unofficial Release"], 2025, 4),
  ];
  return {
    params: { track: "neon static", artist: "Mira Vale", type: "release", format: "Vinyl", per_page: "50", page: "1" },
    response: search(hits, { pages: 1, items: 21 }),
  };
};

// 3. The FIX with the track only: 173 vinyl hits over 4 pages; the artist's album and single are among them, and so is a real
//    LP + CD set (it contains vinyl, so it stays).
export const trackOnlyVinyl = () => {
  nextId = 7_300_000;
  const artists = ["Cobalt Parade", "Lumen Choir", "The Quiet Orchard", "Saffron Line", "Dune Registry", "Paper Lantern", "Harbor Lights"];
  const hits: Hit[] = [
    hit(910002, "Mira Vale", "Neon Static (Tide Remix)", ["Vinyl", '12"', "45 RPM", "Single"], 2014, 0),
    hit(910001, "Mira Vale", "Static Bloom", ["Vinyl", "LP", "Test Pressing", "Stereo"], 2025, 1),
  ];
  for (let i = 0; i < 47; i++) hits.push(hit(950000 + (i % 24), cycle(artists, i), "Neon Static", ["Vinyl", cycle(['12"', "LP", '7"'], i), "Single"], 1995 + (i % 25), i));
  hits.push(hit(951000, "The Offering Hour", "Home", ["Vinyl", "LP", "Album", "CD", "Album"], 2023, 2)); // an LP + CD set
  return { params: { track: "neon static", type: "release", format: "Vinyl", per_page: "50", page: "1" }, response: search(hits.slice(0, 50), { pages: 4, items: 173 }) };
};

// 4. Artist + track: another popular track by another invented artist, narrowed by artist. 63 vinyl hits over 2 pages; the
//    artist's group has 6 masters and 10 standalone releases; three other artists have one release each.
export const anotherRoundByCobaltParade = () => {
  nextId = 7_400_000;
  const A = "Cobalt Parade";
  const hits: Hit[] = [];
  const counts: Array<[number, number]> = [[920001, 9], [920002, 7], [920003, 5], [920004, 4], [920005, 3], [920006, 3]];
  let n = 0;
  for (const [master, count] of counts) for (let i = 0; i < count; i++) hits.push(hit(master, A, "Another Round", ["Vinyl", '12"', cycle(["33 ⅓ RPM", "45 RPM"], i)], 1999 + (n++ % 12), n));
  for (let i = 0; i < 10; i++) hits.push(hit(0, A, `Another Round (Bootleg ${i + 1})`, ["Vinyl", '12"', "Unofficial Release"], 2004 + i, i));
  hits.push(hit(0, "Cobalt Parade Vs Atlas", "Another Round", ["Vinyl", '12"'], 2008), hit(0, "Cobalt Parade / Dune", "Another Round", ["Vinyl", '12"'], 2009), hit(0, "Kestrel / Cobalt Parade", "Another Round", ["Vinyl", '7"'], 2010));
  return { params: { track: "another round", artist: A, type: "release", format: "Vinyl", per_page: "50", page: "1" }, response: search(hits, { pages: 2, items: 63 }) };
};

// 5. Artist mode (vinyl releases of one artist): 394 hits over 8 pages; page 1 holds 26 distinct masters and 5 standalone releases.
export const artistModeVinyl = () => {
  nextId = 7_500_000;
  const hits: Hit[] = [];
  for (let m = 0; m < 26; m++) {
    const copies = m < 3 ? 4 : m < 8 ? 2 : 1;
    for (let c = 0; c < copies && hits.length < 45; c++) hits.push(hit(930000 + m, "Mira Vale", `Album ${m + 1}`, ["Vinyl", "LP", cycle(["Album", "Reissue", "Limited Edition"], c)], 2010 + (m % 15), c));
  }
  for (let i = 0; hits.length < 50; i++) hits.push(hit(0, "Mira Vale", `Bootleg ${i + 1}`, ["Vinyl", "LP", "Unofficial Release"], 2020 + i, i));
  return { params: { artist: "Mira Vale", type: "release", format: "Vinyl", per_page: "50", page: "1" }, response: search(hits, { pages: 8, items: 394 }) };
};

// 6. Album mode: release_title + artist. 18 vinyl hits: 14 of the album, 2 of the single, 2 standalone.
export const albumModeVinyl = () => {
  nextId = 7_600_000;
  const hits: Hit[] = [
    ...Array.from({ length: 14 }, (_, i) => hit(910001, "Mira Vale", "Static Bloom", ["Vinyl", "LP", "Album", ...(i % 3 === 0 ? ["Reissue"] : [])], 2014 + (i % 5), i)),
    hit(910002, "Mira Vale", "Neon Static (Tide Remix)", ["Vinyl", '12"', "Single"], 2014, 1),
    hit(910002, "Mira Vale", "Neon Static", ["Vinyl", '7"', "Single"], 2014, 2),
    hit(0, "Mira Vale", "Static Bloom: Volume II", ["Vinyl", "LP", "Compilation", "Unofficial Release"], 2025, 3),
    hit(0, "Mira Vale", "Static Bloom (Outtakes)", ["Vinyl", "LP", "Unofficial Release"], 2025, 4),
  ];
  return { params: { release_title: "Static Bloom", artist: "Mira Vale", type: "release", format: "Vinyl", per_page: "50", page: "1" }, response: search(hits, { pages: 1, items: 18 }) };
};

// 7. A track that exists only on CD and as files: the vinyl search is EMPTY, the unfiltered one is not.
export const cdOnlyVinylSearch = () => ({
  params: { track: "neon static", artist: "Lumen Choir", type: "release", format: "Vinyl", per_page: "50", page: "1" },
  response: search([], { pages: 1, items: 0 }),
});
export const cdOnlyAnyFormatSearch = () => {
  nextId = 7_700_000;
  return {
    params: { track: "neon static", artist: "Lumen Choir", type: "release", per_page: "50", page: "1" },
    response: search(
      [
        hit(960001, "Lumen Choir", "Tidal Hymn", ["CD", "Single", "Limited Edition"], 2020, 0),
        hit(960001, "Lumen Choir", "Tidal Hymn", ["File", "FLAC", "Single"], 2020, 1),
        hit(960002, "Lumen Choir", "Salt Road", ["File", "MP3", "Single"], 2021, 2),
        hit(960002, "Lumen Choir", "Salt Road", ["File", "FLAC", "Single"], 2021, 3),
      ],
      { pages: 1, items: 4 },
    ),
  };
};

// 8. The album's master record (/masters/910001). The price fields are synthetic placeholders: they must never survive.
export const albumMasterRecord = () => ({
  id: 910001,
  title: "Static Bloom",
  year: 2014,
  uri: "https://www.discogs.com/master/910001-Mira-Vale-Static-Bloom",
  artists: [{ id: 5001, name: "Mira Vale" }],
  images: [{ type: "primary", uri150: "https://i.discogs.com/fixture/master-910001.jpg" }],
  lowest_price: 1.11,
  num_for_sale: 11,
});

// 9. The album's vinyl pressings (/masters/910001/versions?format=Vinyl): 14 rows (one is a Box Set, which Discogs keeps
//    because it can contain LPs) and facets whose VALUES are form-encoded, exactly as the real API sends them.
export const albumVinylVersions = () => {
  const countries = ["US", "UK", "Worldwide", "Europe", "Port Esme, Calder, & Vane"];
  const labels = ["Harbor Records Ltd. (Uk)", "Glass Tide", "Big Lantern", "Easy Orchard Studios, Port Esme, Tn"];
  const versions = Array.from({ length: 13 }, (_, i) => ({
    id: 880001 + i,
    title: "Static Bloom",
    label: cycle(labels, i),
    catno: `HR-${100 + i}`,
    country: cycle(countries, i),
    released: String(2014 + (i % 4)),
    format: cycle(["LP, Album", "LP, Album, Deluxe Edition", "LP, Album, Stereo"], i),
    major_formats: ["Vinyl"],
  }));
  versions.push({ id: 880014, title: "Static Bloom", label: labels[0], catno: "HR-BOX", country: "UK", released: "2014", format: "Limited Edition", major_formats: ["Box Set"] });
  // form-encoding as Discogs sends facet values: space = "+", and parentheses are percent-encoded too
  const encode = (s: string) => encodeURIComponent(s).replace(/%20/g, "+").replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const facet = (id: string, values: string[]) => ({ id, values: values.map((v, i) => ({ title: v, value: encode(v), count: values.length - i })) });
  return {
    params: { format: "Vinyl", per_page: "50", page: "1" },
    response: {
      pagination: pagination(1, 1, 14),
      versions,
      filter_facets: [facet("country", countries), facet("label", labels), facet("released", ["2014", "2015", "2016", "2017"]), facet("format", ["Vinyl"])],
    },
  };
};
