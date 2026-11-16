/** Raw-shaped Discogs payloads (trimmed) used by unit tests AND the mock server. Includes marketplace fields on purpose. */

/**
 * Synthetic Discogs-shaped payloads for unit tests AND the mock server. Searches are VINYL RELEASE searches (that is
 * what the app asks for), so every hit is a release; one CD hit is mixed in on purpose to prove it is dropped.
 * Marketplace fields are included on purpose to prove they never survive. Real recorded responses live in ./real.
 */
export const searchPage1 = {
  pagination: { page: 1, pages: 3, per_page: 50, items: 120 },
  results: [
    // releases of one master. The FIRST hit is a remix: its title must not become the album's title.
    { id: 1001, type: "release", master_id: 500, title: "Cobalt Parade - Glass Harbor (Remixes)", year: "2001", country: "Europe", format: ["Vinyl", "LP", "Album"], thumb: "https://i.discogs.com/aaa/thumb1.jpg", uri: "/release/1001-Glass-Harbor", lowest_price: 42.5, num_for_sale: 77, community: { have: 10, want: 20 } },
    { id: 1002, type: "release", master_id: 500, title: "Cobalt Parade - Glass Harbor", year: "2001", country: "US", format: ["Vinyl", "LP", "Album", "Reissue"], thumb: "", uri: "/release/1002-Glass-Harbor" },
    // a CD of the same master: NOT vinyl, must be dropped even if Discogs sent it
    { id: 1004, type: "release", master_id: 500, title: "Cobalt Parade - Glass Harbor", year: "2001", country: "UK", format: ["CD", "Album"], thumb: "https://i.discogs.com/aaa/cd.jpg", uri: "/release/1004-Glass-Harbor" },
    // same artist, different case; another master
    { id: 1005, type: "release", master_id: 600, title: "COBALT PARADE - Paper Tide", year: "1997", format: ["Vinyl", "LP", "Album"], thumb: "https://st.discogs.com/spacer.gif", uri: "/release/1005-Paper-Tide" },
    // standalone vinyl release (master_id = 0)
    { id: 2001, type: "release", master_id: 0, title: "Some Band - Rare Single", year: "1999", format: ["Vinyl", "7\"", "Single"], thumb: "https://i.discogs.com/bbb/single.jpg", uri: "/release/2001-Rare-Single" },
    // duplicate standalone id
    { id: 2001, type: "release", master_id: 0, title: "Some Band - Rare Single", year: "1999", format: ["Vinyl", "7\""] },
    // no artist separator
    { id: 3001, type: "release", master_id: 0, title: "Untitled Mystery", format: ["Vinyl", "12\""] },
    // junk
    { id: "x", type: "artist", title: "Nope" },
    null,
  ],
};

export const searchPage2 = {
  pagination: { page: 2, pages: 3, per_page: 50, items: 120 },
  results: [
    { id: 1003, type: "release", master_id: 500, title: "Cobalt Parade - Glass Harbor", year: "2001", format: ["Vinyl", "LP", "Album"] },
    { id: 700, type: "release", master_id: 700, title: "Cobalt Parade - Alive In Dusk", year: "2007", format: ["Vinyl", "LP", "Album"], thumb: "https://i.discogs.com/ccc/alive.jpg", uri: "/release/700-Alive" },
  ],
};

/** Master records as /masters/{id} returns them (with price fields, which must never survive). */
export const masterPayloads: Record<number, Record<string, unknown>> = {
  500: { id: 500, title: "Glass Harbor", year: 2001, uri: "https://www.discogs.com/master/500-Cobalt-Parade-Glass-Harbor", artists: [{ id: 1, name: "Cobalt Parade" }], images: [{ type: "primary", uri150: "https://i.discogs.com/m/500.jpg" }], lowest_price: 9.99, num_for_sale: 123 },
  600: { id: 600, title: "Paper Tide", year: 1997, uri: "https://www.discogs.com/master/600-Cobalt-Parade-Paper-Tide", artists: [{ id: 1, name: "Cobalt Parade" }], images: [{ type: "primary", uri150: "https://i.discogs.com/m/600.jpg" }], lowest_price: 8.5, num_for_sale: 55 },
  700: { id: 700, title: "Alive In Dusk", year: 2007, uri: "https://www.discogs.com/master/700-Cobalt-Parade-Alive-In-Dusk", artists: [{ id: 1, name: "Cobalt Parade" }], images: [], lowest_price: 7, num_for_sale: 9 },
};

export const versionsPage = {
  pagination: { page: 1, pages: 1, per_page: 50, items: 4 },
  versions: [
    { id: 11, title: "Glass Harbor", label: "Virgin", catno: "V 2975", country: "UK", released: "2001", format: "2xLP, Album", major_formats: ["Vinyl"], thumb: "https://i.discogs.com/v/11.jpg", status: "Accepted", stats: { community: { in_wantlist: 5, in_collection: 9 } }, price: "30.00" },
    { id: 11, title: "Glass Harbor", label: "Virgin", catno: "V 2975", country: "UK", released: "2001", major_formats: ["Vinyl"] },
    // a CD: NOT vinyl, must be dropped even if Discogs sent it
    { id: 12, title: "Glass Harbor", label: "Virgin", catno: "8 50000", country: "France", released: "2001", format: "CD, Album", major_formats: ["CD"] },
    { id: 13, title: "Glass Harbor", label: "Victor", catno: "VICP-61", country: "Japan", released: "2002", format: "LP, Album", major_formats: ["Vinyl"] },
    { id: 14, title: "Glass Harbor", label: "Virgin", catno: "V 2975 R", country: "US", released: "2001", format: "LP, Album, Reissue", major_formats: ["Vinyl"] },
  ],
  filter_facets: [
    { id: "country", title: "Country", values: [{ title: "UK", value: "UK", count: 1 }, { title: "Japan", value: "Japan", count: 1 }, { title: "US", value: "US", count: 1 }] },
    { id: "released", title: "Year", values: [{ title: "2002", value: "2002", count: 1 }, { title: "2001", value: "2001", count: 2 }] },
    { id: "label", title: "Label", values: [{ title: "Virgin", value: "Virgin", count: 2 }, { title: "Victor", value: "Victor", count: 1 }] },
    { id: "format", title: "Format", values: [{ title: "Vinyl", value: "Vinyl", count: 3 }] },
  ],
};

export const releasePayload = {
  id: 1001,
  master_id: 500,
  title: "Glass Harbor",
  artists: [{ id: 1, name: "Cobalt Parade", join: "" }],
  year: 2001,
  released: "2001-03-12",
  country: "Europe",
  uri: "https://www.discogs.com/release/1001-Glass-Harbor",
  labels: [{ name: "Virgin", catno: "V 2975" }],
  formats: [{ name: "Vinyl", qty: "2", descriptions: ["LP", "Album"] }],
  genres: ["Electronic"],
  styles: ["House", "Disco"],
  tracklist: [
    { position: "A1", title: "Slow Orbit", duration: "5:20", type_: "track" },
    { position: "", title: "Side B", duration: "", type_: "heading" },
  ],
  images: [
    { type: "secondary", uri: "https://i.discogs.com/img/sec.jpg", uri150: "https://i.discogs.com/img/sec150.jpg" },
    { type: "primary", uri: "https://i.discogs.com/img/primary.jpg", uri150: "https://i.discogs.com/img/primary150.jpg" },
  ],
  identifiers: [
    { type: "Barcode", value: "724384960650" },
    { type: "Matrix / Runout", value: "VIRGIN V2975 A1" },
    { type: "Other", value: "not kept" },
  ],
  // marketplace / community data that must never survive normalization:
  lowest_price: 42.5,
  num_for_sale: 77,
  estimated_weight: 460,
  blocked_from_sale: false,
  community: { have: 1000, want: 2000, rating: { average: 4.6, count: 300 } },
};
