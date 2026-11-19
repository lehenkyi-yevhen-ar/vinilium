import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { discogsBucket, discogsCache, rateLimit } from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";
import { createTestDb } from "../helpers/pglite";
import { setEnv } from "../helpers/env";

/**
 * What the app does when Discogs misbehaves: 429 with and without Retry-After, 5xx, timeouts, slow answers, malformed and incomplete
 * bodies, empty and huge pages, a master without versions, a removed release. Every scenario checks the OUTCOME the UI maps to a state
 * (throttled with a countdown, error with retry, not found, empty), that nothing from the upstream body or our credentials leaks into it,
 * and that retries are bounded and wait with jitter. A fake fetch stands in for Discogs; a fake clock and sleep keep it instant.
 */

let db: AppDb;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());
beforeEach(async () => {
  vi.resetModules();
  setEnv({ DISCOGS_API_BASE: "http://discogs.test", DISCOGS_CONSUMER_KEY: "FAKE-key-should-never-leak", DISCOGS_CONSUMER_SECRET: "FAKE-secret-should-never-leak" });
  await db.delete(discogsCache);
  await db.delete(discogsBucket);
  await db.delete(rateLimit);
});

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const HOSTILE = "UPSTREAM-BODY-MARKER <script>alert(1)</script>";

function kit(fetchImpl: (u: URL) => Promise<Response> | Response, extra: Record<string, unknown> = {}) {
  const sleeps: number[] = [];
  const f = vi.fn(async (u: URL | string) => fetchImpl(new URL(String(u))));
  let t = 1_000_000;
  // sleeping moves the fake clock forward, so a block that lasts 2 s really is over after a 2 s wait
  const sleep = async (ms: number) => {
    sleeps.push(ms);
    t += ms;
  };
  const deps = { db, fetchImpl: f as unknown as typeof fetch, sleep, random: () => 0.5, now: () => t, ...extra };
  return { deps, f, sleeps, advance: (ms: number) => (t += ms) };
}
const noLeak = (value: unknown) => expect(JSON.stringify(value)).not.toMatch(/UPSTREAM-BODY-MARKER|should-never-leak|Authorization|Discogs key=|stack|ECONN/i);

describe("rate limiting by Discogs", () => {
  it("a 429 with a short Retry-After is waited out (with jitter) and then succeeds", async () => {
    const { searchDiscogs } = await import("@/server/discogs/service");
    let n = 0;
    const k = kit(() => (++n === 1 ? json({ message: HOSTILE }, 429, { "retry-after": "2" }) : json({ pagination: { page: 1, pages: 1, per_page: 50, items: 0 }, results: [] })));
    const r = await searchDiscogs(k.deps, { mode: "artist", query: "chaos 429 short", page: 1 });
    expect(r.ok).toBe(true);
    expect(k.f).toHaveBeenCalledTimes(2);
    expect(k.sleeps).toHaveLength(1);
    expect(k.sleeps[0]).toBeGreaterThanOrEqual(2000); // Retry-After is a floor
    expect(k.sleeps[0]).toBeLessThanOrEqual(3000); // never a long stall inside one request
  });

  it("a 429 WITHOUT Retry-After backs off by at least a second, and gives up as 'throttled' with a countdown instead of hammering", async () => {
    const { searchDiscogs } = await import("@/server/discogs/service");
    const k = kit(() => json({ message: HOSTILE }, 429));
    const r = await searchDiscogs(k.deps, { mode: "artist", query: "chaos 429 none", page: 1 });
    expect(r).toMatchObject({ ok: false, error: "throttled" });
    if (!r.ok && r.error === "throttled") expect(r.retryAfter).toBeGreaterThanOrEqual(1);
    expect(k.f.mock.calls.length).toBeLessThanOrEqual(4); // bounded: the first call plus at most 3 retries
    for (const s of k.sleeps) expect(s).toBeGreaterThanOrEqual(1000);
    expect(k.sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(8000); // bounded total wait
    noLeak(r);
  });

  it("a 429 with a LONG Retry-After is not waited for: one call, 'throttled' with that many seconds", async () => {
    const { getRelease } = await import("@/server/discogs/service");
    const k = kit(() => json({}, 429, { "retry-after": "120" }));
    const r = await getRelease(k.deps, 4242);
    expect(r).toMatchObject({ ok: false, error: "throttled" });
    if (!r.ok && r.error === "throttled") expect(r.retryAfter).toBeGreaterThanOrEqual(120);
    expect(k.f).toHaveBeenCalledTimes(1);
    expect(k.sleeps).toHaveLength(0);
  });

  it("after a 429 every other request is held back without calling Discogs (the shared block)", async () => {
    const { getRelease } = await import("@/server/discogs/service");
    const k = kit(() => json({}, 429, { "retry-after": "60" }));
    await getRelease(k.deps, 1);
    const callsAfterFirst = k.f.mock.calls.length;
    const second = await getRelease(k.deps, 2);
    expect(second).toMatchObject({ ok: false, error: "throttled" });
    expect(k.f.mock.calls.length).toBe(callsAfterFirst); // nothing more was sent
  });
});

describe("a failing Discogs", () => {
  for (const status of [500, 502, 503]) {
    it(`${status}: retried a bounded number of times, then 'upstream' (the screen offers a retry), body not leaked`, async () => {
      const { getRelease } = await import("@/server/discogs/service");
      const k = kit(() => json({ message: HOSTILE }, status));
      const r = await getRelease(k.deps, 10 + status);
      expect(r).toEqual({ ok: false, error: "upstream" });
      expect(k.f.mock.calls.length).toBeLessThanOrEqual(3);
      for (const s of k.sleeps) expect(s).toBeLessThanOrEqual(8000 * 1.0); // full jitter below the cap
      noLeak(r);
    });
  }

  it("a timeout (the request is aborted) is retried a bounded number of times, then 'upstream'", async () => {
    const { getRelease } = await import("@/server/discogs/service");
    const k = kit(() => Promise.reject(new DOMException("The operation was aborted", "TimeoutError")));
    const r = await getRelease(k.deps, 7001);
    expect(r).toEqual({ ok: false, error: "upstream" });
    expect(k.f.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("a slow but good answer is still used", async () => {
    const { getRelease } = await import("@/server/discogs/service");
    const k = kit(async () => {
      await new Promise((r) => setTimeout(r, 60));
      return json({ id: 7002, title: "Slow record", formats: [{ name: "Vinyl", qty: 1 }] });
    });
    const r = await getRelease(k.deps, 7002);
    expect(r.ok).toBe(true);
  });

  it("malformed JSON, a body that is not an object, and a release with no usable fields all end as 'upstream', never a crash", async () => {
    const { getRelease } = await import("@/server/discogs/service");
    for (const [id, make] of [
      [7101, () => new Response("{ not json " + HOSTILE, { status: 200, headers: { "content-type": "application/json" } })],
      [7102, () => json(["unexpected", "array"])],
      [7103, () => json(null)],
      [7104, () => json({})],
      [7105, () => json({ id: "not a number", title: 5 })],
    ] as const) {
      const k = kit(make);
      const r = await getRelease(k.deps, id);
      expect(r, `release ${id}`).toEqual({ ok: false, error: "upstream" });
      noLeak(r);
    }
  });

  it("a release removed from Discogs (404) is 'not_found', and a batch remembers it so the next page view does not ask again", async () => {
    const { getRelease, getReleases } = await import("@/server/discogs/service");
    const single = kit(() => json({ message: HOSTILE }, 404));
    expect(await getRelease(single.deps, 7201)).toEqual({ ok: false, error: "not_found" });

    const batch = kit((u) => (u.pathname.endsWith("/7202") ? json({ message: HOSTILE }, 404) : json({ id: Number(u.pathname.split("/").pop()), title: "Here", formats: [{ name: "Vinyl", qty: 1 }] })));
    const first = await getReleases(batch.deps, [7202, 7203]);
    expect(first.ok && first.data.gone).toEqual([7202]);
    const calls = batch.f.mock.calls.length;
    const again = await getReleases(batch.deps, [7202, 7203]);
    expect(again.ok && again.data.gone).toEqual([7202]);
    expect(batch.f.mock.calls.length).toBe(calls); // gone is remembered (an hour), the card is cached
  });
});

describe("odd but valid answers", () => {
  it("an empty result is a normal, empty page (the screen offers other kinds of search)", async () => {
    const { searchDiscogs } = await import("@/server/discogs/service");
    const k = kit(() => json({ pagination: { page: 1, pages: 0, per_page: 50, items: 0 }, results: [] }));
    const r = await searchDiscogs(k.deps, { mode: "track", query: "nothing at all", page: 1 });
    expect(r.ok && r.data.groups).toEqual([]);
    expect(r.ok && r.data.totalItems).toBe(0);
  });

  it("results with missing fields are skipped, not fatal", async () => {
    const { searchDiscogs } = await import("@/server/discogs/service");
    const k = kit(() => json({ pagination: {}, results: [{}, { id: 1 }, { title: "No id" }, null, 5, "x", { id: 2, title: "Artist - Album", type: "release", format: ["Vinyl"] }] }));
    const r = await searchDiscogs(k.deps, { mode: "album", query: "sparse", page: 1 });
    expect(r.ok).toBe(true);
    noLeak(r);
  });

  it("a huge page (5,000 hits) is handled in reasonable time and does not blow up", async () => {
    const { searchDiscogs } = await import("@/server/discogs/service");
    const results = Array.from({ length: 5000 }, (_, i) => ({ id: 100000 + i, title: `Artist ${i % 300} - Album ${i}`, type: "release", format: ["Vinyl", "LP"], year: "1999", master_id: 50000 + (i % 700) }));
    const k = kit(() => json({ pagination: { page: 1, pages: 1, per_page: 5000, items: 5000 }, results }));
    const t0 = Date.now();
    const r = await searchDiscogs(k.deps, { mode: "album", query: "huge", page: 1 });
    expect(r.ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it("a master without versions is an empty pressings page with its filters, not an error", async () => {
    const { getMasterVersions } = await import("@/server/discogs/service");
    const k = kit(() => json({ pagination: { page: 1, pages: 1, per_page: 50, items: 0 }, versions: [] }));
    const r = await getMasterVersions(k.deps, { masterId: 7301, page: 1 });
    expect(r.ok && r.data.versions).toEqual([]);
    const missing = kit(() => json({ pagination: { page: 1, pages: 1, per_page: 50, items: 0 } }));
    const r2 = await getMasterVersions(missing.deps, { masterId: 7302, page: 1 });
    expect(r2.ok).toBe(true);
  });
});

describe("the image proxy when the image host misbehaves", () => {
  const URL_OK = "https://i.discogs.com/abc/def.jpg";
  const png = () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "content-type": "image/png" } });
  beforeEach(() => {
    delete process.env.DISCOGS_API_BASE; // the proxy allows the image hosts of the REAL API only when it is not pointed at a mock
  });

  it("429 -> throttled with a countdown; timeout -> upstream; non-image content types are refused", async () => {
    const { proxyImage } = await import("@/server/discogs/image");
    const base = { db, sleep: async () => {}, random: () => 0.5 };
    const limited = await proxyImage(URL_OK, { ...base, fetchImpl: (async () => new Response("", { status: 429, headers: { "retry-after": "30" } })) as unknown as typeof fetch });
    expect(limited).toMatchObject({ ok: false, kind: "throttled" });
    await db.delete(discogsBucket); // the 429 blocked the image budget for 30 s (as it should); start the next cases with it open
    const timeout = await proxyImage(URL_OK, { ...base, fetchImpl: (async () => Promise.reject(new DOMException("aborted", "TimeoutError"))) as unknown as typeof fetch });
    expect(timeout).toMatchObject({ ok: false });
    for (const type of ["text/html", "application/json", "image/svg+xml", "application/octet-stream"]) {
      const out = await proxyImage(URL_OK, { ...base, fetchImpl: (async () => new Response("<html>" + HOSTILE, { status: 200, headers: { "content-type": type } })) as unknown as typeof fetch });
      expect(out.ok, type).toBe(false);
      noLeak(out);
    }
    const good = await proxyImage(URL_OK, { ...base, fetchImpl: (async () => png()) as unknown as typeof fetch });
    expect(good.ok).toBe(true);
  });
});

describe("the shared budget under concurrent users", () => {
  it("never lets more calls through than the bucket holds, however many people cold-load at once", async () => {
    const { getReleases } = await import("@/server/discogs/service");
    const { coldLimiter } = await import("@/server/discogs/cold-limit");
    let upstream = 0;
    const fetchImpl = vi.fn(async (u: URL | string) => {
      upstream++;
      return json({ id: Number(new URL(String(u)).pathname.split("/").pop()), title: "Cold", formats: [{ name: "Vinyl", qty: 1 }] });
    });
    const now = () => 5_000_000; // a frozen clock: nothing refills during the test, so the bucket's capacity is the whole budget
    const make = (userId: string) => ({ db, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {}, random: () => 0.5, now, maxSingleWaitMs: 0, coldLimit: coldLimiter(db, userId, { limit: 24, now }) });

    // 12 people, each opening a list page of 12 DIFFERENT uncached releases at the same moment: 144 wanted, the bucket starts at 25
    const results = await Promise.all(Array.from({ length: 12 }, (_, u) => getReleases(make(`user-${u}`), Array.from({ length: 12 }, (_, i) => 800_000 + u * 100 + i))));
    expect(upstream).toBeLessThanOrEqual(25);
    expect(upstream).toBeGreaterThan(0);
    const [bucket] = await db.select().from(discogsBucket);
    expect(bucket.tokens).toBeGreaterThanOrEqual(0); // never overdrawn
    let resolved = 0;
    let waiting = 0;
    for (const r of results) {
      expect(r.ok).toBe(true);
      if (r.ok) {
        resolved += r.data.releases.length;
        if (r.data.retryAfter !== undefined) waiting++;
      }
    }
    expect(resolved).toBe(upstream); // every call that went out was used by someone, none wasted
    expect(waiting).toBeGreaterThan(0); // the others are told to wait, with a countdown
  });

  it("one person cannot use more than their own cold allowance, whatever they open", async () => {
    const { getReleases } = await import("@/server/discogs/service");
    const { coldLimiter } = await import("@/server/discogs/cold-limit");
    let upstream = 0;
    const fetchImpl = vi.fn(async (u: URL | string) => {
      upstream++;
      return json({ id: Number(new URL(String(u)).pathname.split("/").pop()), title: "Cold", formats: [{ name: "Vinyl", qty: 1 }] });
    });
    const now = () => 6_000_000;
    // a bucket far bigger than the cap, so only the person's allowance can be what stops this
    const { acquireToken } = await import("@/server/discogs/token-bucket");
    await acquireToken(db, { id: "api:discogs.test", now: now(), capacity: 1000 });
    const deps = { db, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {}, random: () => 0.5, now, coldLimit: coldLimiter(db, "greedy", { limit: 24, now }) };
    const first = await getReleases(deps, Array.from({ length: 24 }, (_, i) => 900_000 + i));
    const second = await getReleases(deps, Array.from({ length: 24 }, (_, i) => 910_000 + i));
    expect(upstream).toBeLessThanOrEqual(24);
    expect(first.ok && second.ok).toBe(true);
    expect(second.ok && second.data.retryAfter).toBeGreaterThanOrEqual(1);
    expect(second.ok && second.data.missing.length).toBeGreaterThan(0);
  });
});
