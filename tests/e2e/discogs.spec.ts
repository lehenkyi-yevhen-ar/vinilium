import { expect, test, type APIRequestContext } from "@playwright/test";
import { mergeGroups } from "../../src/lib/discogs/group";
import type { ArtistGroup } from "../../src/lib/discogs/types";

/**
 * The Discogs flow end to end, against the MOCKED Discogs server (tests/mocks/discogs-mock.ts, FAKE credentials):
 * search -> versions -> release -> image proxy, plus cache, throttling and our own limits.
 * Needs a real Postgres (cache, token bucket and limiter live there): see playwright.config.ts.
 */
test.skip(!process.env.E2E_HAS_DB, "Needs DATABASE_URL (e.g. a throwaway Neon branch); the Discogs flow stores its cache and limits in Postgres.");
test.describe.configure({ mode: "serial" });

const MOCK = "http://localhost:3201";
const RUN = Date.now().toString(36);
const OCTET = 1 + Math.floor(Math.random() * 190);
/** Each test uses its own client IP (documentation range 203.0.113.0/24), so limiter buckets never collide. */
const ip = (n: number) => ({ "x-forwarded-for": `203.0.113.${OCTET + n}` });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MARKETPLACE = ["lowest_price", "num_for_sale", "estimated_weight", "blocked_from_sale", "community", "\"price\""];

const search = (request: APIRequestContext, q: string, n: number, extra = "") =>
  request.get(`/api/discogs/search?q=${encodeURIComponent(q)}&mode=artist${extra}`, { headers: ip(n) });
const mockLog = async (request: APIRequestContext) => (await request.get(`${MOCK}/__log`)).json() as Promise<Array<{ path: string; query: Record<string, string>; authorization: string | null; userAgent: string | null; status: number }>>;

let thumb = "";
let groupsPage1: ArtistGroup[] = [];
const Q1 = `daft-${RUN}-a`;

test.beforeAll(async ({ request }) => {
  await request.post(`${MOCK}/__reset`);
  await request.post(`${MOCK}/__control`, { data: { throttleNext: 0 } });
});

test("search groups by artist, dedupes, treats master_id 0 as standalone, and strips marketplace data", async ({ request }) => {
  const res = await search(request, Q1, 1);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.cached).toBe(false);

  const groups: ArtistGroup[] = body.data.groups;
  groupsPage1 = groups;
  expect(groups.map((g) => g.artist)).toEqual(["Cobalt Parade", "Some Band", null]);

  const discovery = groups[0].entries[0];
  expect(discovery).toMatchObject({ key: "m:500", kind: "master", id: 500, mergedHits: 2 }); // 2 VINYL releases -> ONE entry; the CD of that master never arrives
  expect(JSON.stringify(groups)).not.toMatch(/"CD"/); // vinyl only
  expect(groups[1].entries[0]).toMatchObject({ key: "r:2001", kind: "release", mergedHits: 2 }); // master_id 0 = standalone, deduped by id

  expect(body.data).toMatchObject({ page: 1, pages: 3, hasMore: true, incomplete: true }); // honest "may be incomplete"

  const raw = JSON.stringify(body);
  for (const k of MARKETPLACE) expect(raw).not.toContain(k);
  expect(raw).not.toContain("42.5");

  thumb = discovery.thumb!;
  expect(thumb).toMatch(/^\/api\/discogs\/image\?u=/);
  expect(new URL(thumb, "http://x").searchParams.get("u")).toBe(`${MOCK}/images/aaa/thumb1.jpg`);
  expect(raw).not.toContain("i.discogs.com"); // the browser never sees an upstream image URL
});

test("an identical search is served from the cache (Discogs is not called again)", async ({ request }) => {
  const res = await search(request, `  ${Q1.toUpperCase()}  `, 2); // same query after normalisation
  const body = await res.json();
  expect(body.cached).toBe(true);
  const hits = (await mockLog(request)).filter((e) => e.path === "/database/search" && e.query.artist === Q1);
  expect(hits).toHaveLength(1);
});

test("calls Discogs with the app's credentials and a descriptive User-Agent", async ({ request }) => {
  const entry = (await mockLog(request)).find((e) => e.path === "/database/search" && e.query.artist === Q1)!;
  expect(entry.authorization).toBe("Discogs key=test-key, secret=test-secret");
  expect(entry.userAgent).toMatch(/^Vinilium\/0\.1 \(/);
  // ALWAYS vinyl releases (a master search cannot be filtered by medium: see the regression tests)
  expect(entry.query).toMatchObject({ type: "release", format: "Vinyl", per_page: "50", page: "1" });
});

test("'load more' fetches page 2 and merges it without duplicating masters", async ({ request }) => {
  const res = await search(request, Q1, 3, "&page=2");
  const body = await res.json();
  expect(body.data.page).toBe(2);
  const merged = mergeGroups(groupsPage1, body.data.groups);
  const daft = merged.find((g) => g.artist === "Cobalt Parade")!;
  expect(daft.entries.map((e) => e.key)).toEqual(["m:500", "m:600", "m:700"]);
  expect(daft.entries[0].mergedHits).toBe(3); // 2 vinyl releases on page 1 + 1 on page 2
});

test("lists a master's VINYL versions, deduped and without prices", async ({ request }) => {
  const res = await request.get("/api/discogs/masters/500/versions", { headers: ip(4) });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.data.versions.map((v: { id: number }) => v.id)).toEqual([11, 13, 14]); // the French CD (12) is not a pressing here
  const asked = (await mockLog(request)).filter((e) => e.path === "/masters/500/versions").at(-1)!;
  expect(asked.query).toMatchObject({ format: "Vinyl" });
  expect(body.data.facets.country.map((f: { value: string }) => f.value)).not.toContain("France");
  expect(body.data).toMatchObject({ masterId: 500, hasMore: false, incomplete: false });
  expect(body.data.versions[0].discogsUrl).toBe("https://www.discogs.com/release/11");
  const raw = JSON.stringify(body);
  for (const k of [...MARKETPLACE, "stats"]) expect(raw).not.toContain(k);
});

test("resolves albums' own titles, years and covers from their master records (batched, cached, no prices)", async ({ request }) => {
  const res = await request.get("/api/discogs/masters?ids=500,600,404404", { headers: ip(70) });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.data.masters).toMatchObject([
    { id: 500, title: "Glass Harbor", year: 2001, artist: "Cobalt Parade" },
    { id: 600, title: "Paper Tide", year: 1997 },
  ]);
  expect(body.data.missing).toEqual([404404]);
  expect(new URL(body.data.masters[0].thumb, "http://x").searchParams.get("u")).toBe(`${MOCK}/images/m/500.jpg`);
  const raw = JSON.stringify(body);
  for (const k of MARKETPLACE) expect(raw).not.toContain(k);
  expect(raw).not.toContain("9.99");

  const asked = (await mockLog(request)).filter((e) => e.path === "/masters/500" || e.path === "/masters/600");
  const again = await (await request.get("/api/discogs/masters?ids=500,600", { headers: ip(70) })).json();
  expect(again.cached).toBe(true);
  expect((await mockLog(request)).filter((e) => e.path === "/masters/500" || e.path === "/masters/600")).toHaveLength(asked.length); // no new calls
});

test("the masters endpoint takes 1 to 12 ids only", async ({ request }) => {
  for (const q of ["", "ids=", "ids=abc", "ids=1,,2", `ids=${Array.from({ length: 13 }, (_, i) => i + 1).join(",")}`]) {
    expect((await request.get(`/api/discogs/masters${q ? `?${q}` : ""}`, { headers: ip(71) })).status(), q).toBe(400);
  }
});

test("fetches a release, caches it, and strips marketplace data", async ({ request }) => {
  const id = 1_000_000 + (Date.now() % 900_000);
  const first = await request.get(`/api/discogs/releases/${id}`, { headers: ip(5) });
  expect(first.status()).toBe(200);
  const body = await first.json();
  expect(body).toMatchObject({ cached: false, data: { id, title: "Glass Harbor", artist: "Cobalt Parade", masterId: 500 } });
  expect(body.data.tracklist[0]).toMatchObject({ position: "A1", title: "Slow Orbit" });
  expect(body.data.cover).toMatch(/^\/api\/discogs\/image\?u=/);
  const raw = JSON.stringify(body);
  for (const k of MARKETPLACE) expect(raw).not.toContain(k);

  const second = await (await request.get(`/api/discogs/releases/${id}`, { headers: ip(5) })).json();
  expect(second.cached).toBe(true);
  expect((await mockLog(request)).filter((e) => e.path === `/releases/${id}`)).toHaveLength(1);
});

test("rejects bad input and maps 404", async ({ request }) => {
  expect((await request.get("/api/discogs/releases/404404", { headers: ip(6) })).status()).toBe(404);
  for (const path of [
    "/api/discogs/releases/abc",
    "/api/discogs/releases/0",
    "/api/discogs/releases/1.5",
    "/api/discogs/masters/0/versions",
    "/api/discogs/search?mode=artist",
    "/api/discogs/search?q=x&mode=bogus",
    "/api/discogs/search?q=x&mode=master", // masters are never searched
    "/api/discogs/search?q=x&mode=artist&page=6", // beyond the page cap
    "/api/discogs/search?q=&mode=artist",
    `/api/discogs/search?q=${"x".repeat(101)}&mode=artist`,
  ]) {
    const res = await request.get(path, { headers: ip(6) });
    expect(res.status(), path).toBe(400);
    expect((await res.json()).error).toBe("bad_request");
  }
});

test("image proxy streams an authenticated image with cache headers bounded by the TTL", async ({ request }) => {
  const res = await request.get(thumb, { headers: ip(7) });
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  expect(res.headers()["cache-control"]).toBe("public, max-age=300, s-maxage=300");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  const buf = await res.body();
  expect([...buf.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

  const img = (await mockLog(request)).find((e) => e.path === "/images/aaa/thumb1.jpg")!;
  expect(img.authorization).toBe("Discogs key=test-key, secret=test-secret"); // image requests are authenticated
});

test("image proxy only fetches allow-listed Discogs image hosts (SSRF)", async ({ request }) => {
  const before = (await mockLog(request)).length;
  for (const u of [
    "https://evil.example/x.png",
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:3201.evil.example/x.png",
    "http://localhost:3201@evil.example/x.png",
    "http://user:pw@localhost:3201/images/x.png",
    "http://127.0.0.1:3201/images/x.png",
    "http://localhost:9999/images/x.png",
    "file:///etc/passwd",
    "https://i.discogs.com.evil.example/x.png",
  ]) {
    const res = await request.get(`/api/discogs/image?u=${encodeURIComponent(u)}`, { headers: ip(8) });
    if (res.status() === 429) break; // our own limiter kicked in (that is fine, nothing was fetched either way)
    expect(res.status(), u).toBe(400);
  }
  expect((await request.get("/api/discogs/image", { headers: ip(9) })).status()).toBe(400);
  expect((await mockLog(request)).length).toBe(before); // nothing reached the "upstream"
});

test("image proxy handles upstream trouble gracefully", async ({ request }) => {
  const notImage = await request.get(`/api/discogs/image?u=${encodeURIComponent(`${MOCK}/images/notimage.png`)}`, { headers: ip(10) });
  expect(notImage.status()).toBe(502);
  const missing = await request.get(`/api/discogs/image?u=${encodeURIComponent(`${MOCK}/images/missing.png`)}`, { headers: ip(10) });
  expect(missing.status()).toBe(404);
});

test("image 429 from Discogs becomes a clean 'throttled' answer with retryAfter and never blocks API calls", async ({ request }) => {
  const res = await request.get(`/api/discogs/image?u=${encodeURIComponent(`${MOCK}/images/ratelimited.png`)}`, { headers: ip(11) });
  expect(res.status()).toBe(429);
  expect(res.headers()["retry-after"]).toBe("2");
  expect(await res.json()).toMatchObject({ error: "throttled", scope: "discogs", retryAfter: 2 });

  const during = await request.get(thumb, { headers: ip(12) }); // the image block is honoured without calling the image host
  expect(during.status()).toBe(429);
  const api = await search(request, `during-image-429-${RUN}`, 13); // ... while the API keeps working
  expect(api.status()).toBe(200);

  await sleep(2600);
  const after = await request.get(thumb, { headers: ip(14) });
  expect(after.status()).toBe(200);
});

test("a 429 from the API is retried with backoff and jitter, then succeeds", async ({ request }) => {
  const q = `retry-${RUN}`;
  await request.post(`${MOCK}/__control`, { data: { throttleNext: 1, retryAfter: 1 } });
  const t0 = Date.now();
  const res = await search(request, q, 14);
  expect(res.status()).toBe(200);
  expect(Date.now() - t0).toBeGreaterThanOrEqual(900); // it waited
  const attempts = (await mockLog(request)).filter((e) => e.path === "/database/search" && e.query.artist === q);
  expect(attempts.map((a) => a.status)).toEqual([429, 200]);
});

test("when Discogs says 'slow down' for long, the UI gets a 'throttled' state with retryAfter, then recovers", async ({ request }) => {
  await request.post(`${MOCK}/__control`, { data: { throttleNext: 3, retryAfter: 8 } });
  const q = `throttle-${RUN}`;
  const res = await search(request, q, 15);
  expect(res.status()).toBe(429);
  expect(res.headers()["retry-after"]).toBe("8");
  expect(await res.json()).toMatchObject({ error: "throttled", scope: "discogs", retryAfter: 8 });

  // Every instance now shares the block: a different search is refused locally, without calling Discogs.
  const before = (await mockLog(request)).length;
  const second = await search(request, `${q}-2`, 16);
  expect(second.status()).toBe(429);
  expect(((await second.json()) as { retryAfter: number }).retryAfter).toBeGreaterThanOrEqual(1);
  expect((await mockLog(request)).length).toBe(before);

  await request.post(`${MOCK}/__control`, { data: { throttleNext: 0 } });
  await sleep(8600);
  const recovered = await search(request, `${q}-3`, 17);
  expect(recovered.status()).toBe(200);
});

test("our own per-IP limit answers 429 'rate_limited' with Retry-After, and does not affect other IPs", async ({ request }) => {
  const q = `limit-${RUN}`;
  const statuses: number[] = [];
  let last;
  for (let i = 0; i < 62; i++) {
    last = await search(request, q, 40);
    statuses.push(last.status());
  }
  expect(statuses.slice(0, 60)).toEqual(Array(60).fill(200)); // RL_SEARCH_IP_PER_MIN = 60 in this server
  expect(statuses.slice(60)).toEqual([429, 429]);
  expect(await last!.json()).toMatchObject({ error: "rate_limited", scope: "app" });
  expect(Number(last!.headers()["retry-after"])).toBeGreaterThanOrEqual(1);

  expect((await search(request, q, 41)).status()).toBe(200); // another IP is fine
});

test("refuses browser requests that come from another site (no hotlinking / third-party use)", async ({ request }) => {
  for (const path of ["/api/discogs/releases/123", `/api/discogs/image?u=${encodeURIComponent(`${MOCK}/images/a.png`)}`]) {
    const res = await request.get(path, { headers: { ...ip(50), "sec-fetch-site": "cross-site" } });
    expect(res.status(), path).toBe(403);
    expect(await res.json()).toMatchObject({ error: "forbidden" });
  }
});

test("the purge endpoint requires the cron secret", async ({ request }) => {
  expect((await request.get("/api/cron/purge")).status()).toBe(401);
  expect((await request.get("/api/cron/purge", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
  const ok = await request.get("/api/cron/purge", { headers: { authorization: "Bearer e2e-cron-secret-0123456789" } });
  expect(ok.status()).toBe(200);
  const body = await ok.json();
  expect(body).toMatchObject({ ok: true });
  expect(typeof body.cacheRows).toBe("number");
  expect(typeof body.rateLimitRows).toBe("number");
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("search, versions, release, image and lists all answer 401 'unauthorized'", async ({ request }) => {
    for (const path of [
      `/api/discogs/search?q=daft&mode=artist`,
      "/api/discogs/masters/500/versions",
      "/api/discogs/masters?ids=500",
      "/api/discogs/releases/123",
      `/api/discogs/image?u=${encodeURIComponent(`${MOCK}/images/a.png`)}`,
      "/api/lists/items/123",
    ]) {
      const res = await request.get(path, { headers: ip(60) });
      expect(res.status(), path).toBe(401);
      expect(await res.json()).toMatchObject({ error: "unauthorized" });
    }
    expect((await mockLog(request)).some((e) => e.path === "/releases/123")).toBe(false); // nothing reached Discogs
  });
});

test.describe("lists API (one list per pressing)", () => {
  const releaseId = 2_000_000 + (Date.now() % 900_000);
  const url = `/api/lists/items/${releaseId}`;

  test("add, move, remove: a pressing is on one list at a time", async ({ request, baseURL }) => {
    const origin = { origin: baseURL! };
    expect((await (await request.get(url)).json()).item).toBeNull();

    const added = await request.put(url, { data: { list: "wishlist" }, headers: origin });
    expect(added.status()).toBe(200);
    expect(await added.json()).toMatchObject({ result: "added", item: { releaseId, list: "wishlist" } });

    const moved = await request.put(url, { data: { list: "collection" }, headers: origin });
    expect(await moved.json()).toMatchObject({ result: "moved", item: { list: "collection" } });
    expect((await (await request.get(url)).json()).item.list).toBe("collection");

    const same = await request.put(url, { data: { list: "collection" }, headers: origin });
    expect(await same.json()).toMatchObject({ result: "unchanged" });

    const removed = await request.delete(url, { headers: origin });
    expect(await removed.json()).toMatchObject({ removed: true, item: null });
    expect((await (await request.get(url)).json()).item).toBeNull();
  });

  test("rejects bad input, other origins and other sites", async ({ request, baseURL }) => {
    const origin = { origin: baseURL! };
    expect((await request.put(url, { data: { list: "favourites" }, headers: origin })).status()).toBe(400);
    expect((await request.put(url, { data: {}, headers: origin })).status()).toBe(400);
    expect((await request.put("/api/lists/items/abc", { data: { list: "wishlist" }, headers: origin })).status()).toBe(400);
    expect((await request.put(url, { data: { list: "wishlist" }, headers: { origin: "https://evil.example" } })).status()).toBe(403);
    expect((await request.put(url, { data: { list: "wishlist" }, headers: { ...origin, "sec-fetch-site": "cross-site" } })).status()).toBe(403);
    expect((await (await request.get(url)).json()).item).toBeNull(); // none of the rejected requests changed anything
  });
});
