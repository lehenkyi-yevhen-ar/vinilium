import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { discogsBucket, discogsCache, rateLimit } from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";
import { BATCH_CONCURRENCY } from "@/server/discogs/service";
import { createTestDb } from "../helpers/pglite";
import { setEnv } from "../helpers/env";

/**
 * Budgets for the Discogs calls each screen costs, against a fake Discogs, measured in calls and bytes of upstream JSON. Everything that is
 * asserted is BEHAVIOUR, never a duration, so a slow CI runner cannot fail it:
 *  - the call counts are exact (they are what the shared 60-a-minute budget is spent on), cold and warm;
 *  - the concurrency of a batch is proved with a latch: the fake Discogs holds every call until the test lets it go, so the test sees
 *    exactly how many calls are in flight at once (the pool size, never a serial loop, never more than the cap).
 * The PERF lines (calls, bytes, milliseconds) are printed for a reader of the output only; `docs/performance.md` records the last
 * measurement. A run that is slow prints bigger numbers and still passes.
 */

let db: AppDb;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());
beforeEach(async () => {
  vi.resetModules();
  setEnv({ DISCOGS_API_BASE: "http://discogs.test" });
  await db.delete(discogsCache);
  await db.delete(discogsBucket);
  await db.delete(rateLimit);
});

const tail = (u: URL) => Number(u.pathname.split("/").pop());
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function discogs() {
  let calls = 0;
  let bytes = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  let holding = false;
  let waiters: Array<() => void> = [];
  const fetchImpl = vi.fn(async (input: URL | string) => {
    const u = new URL(String(input));
    calls++;
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    // The latch: while holding, a call does not answer until the test releases it.
    if (holding) await new Promise<void>((resolve) => waiters.push(resolve));
    else await Promise.resolve();
    inFlight--;
    let body: unknown;
    if (u.pathname === "/database/search") body = { pagination: { page: 1, pages: 1, per_page: 50, items: 20 }, results: Array.from({ length: 20 }, (_, i) => ({ id: 1000 + i, master_id: 500 + (i % 12), title: `Artist - Album ${i % 12}`, type: "release", format: ["Vinyl", "LP"], year: "1999" })) };
    else if (u.pathname.endsWith("/versions")) body = { pagination: { page: 1, pages: 1, per_page: 50, items: 40 }, versions: Array.from({ length: 40 }, (_, i) => ({ id: 2000 + i, title: `Pressing ${i}`, label: "Label", country: "UK", released: "1999", major_formats: ["Vinyl"] })) };
    else if (u.pathname.startsWith("/masters/")) body = { id: tail(u), title: `Album ${tail(u)}`, year: 1999, artists: [{ name: "Artist" }] };
    else body = { id: tail(u), title: `Record ${tail(u)}`, year: 1999, country: "UK", artists: [{ name: "Artist" }], labels: [{ name: "Label", catno: "L-1" }], formats: [{ name: "Vinyl", qty: 1, descriptions: ["LP"] }], tracklist: Array.from({ length: 12 }, (_, i) => ({ position: `A${i + 1}`, title: `Track ${i + 1}`, duration: "3:00", type_: "track" })) };
    const text = JSON.stringify(body);
    bytes += text.length;
    return new Response(text, { status: 200, headers: { "content-type": "application/json" } });
  });
  return {
    fetchImpl,
    stats: () => ({ calls, bytes, maxInFlight }),
    inFlight: () => inFlight,
    reset: () => ((calls = 0), (bytes = 0), (maxInFlight = 0)),
    hold: () => (holding = true),
    release: () => {
      const w = waiters;
      waiters = [];
      for (const r of w) r();
    },
    stopHolding: () => (holding = false),
  };
}

function report(label: string, calls: number, bytes: number, ms: number) {
  // Informational only: nothing asserts on these numbers.
  console.log(`PERF ${label.padEnd(34)} calls=${String(calls).padStart(2)} upstream_bytes=${String(bytes).padStart(6)} time=${String(ms).padStart(4)} ms`);
}

async function measure<T>(label: string, d: ReturnType<typeof discogs>, run: () => Promise<T>) {
  d.reset();
  const t0 = performance.now();
  const out = await run();
  const { calls, bytes, maxInFlight } = d.stats();
  report(label, calls, bytes, Math.round(performance.now() - t0));
  return { out, calls, bytes, maxInFlight };
}

/**
 * Runs `run` with the latch closed. It waits (for a CONDITION, with no time limit that a slow runner could hit) until the batch has
 * `cap` calls in flight, lets a few turns of the event loop pass and checks that no call beyond the cap was started while those are held,
 * then lets everything go and returns what was measured.
 */
async function measureGated<T>(label: string, d: ReturnType<typeof discogs>, cap: number, run: () => Promise<T>) {
  d.reset();
  d.hold();
  const t0 = performance.now();
  const p = run();
  await vi.waitFor(() => expect(d.inFlight()).toBe(cap), { timeout: 30_000, interval: 2 });
  for (let i = 0; i < 20; i++) await tick();
  expect(d.inFlight(), "no call beyond the cap starts while the cap is in flight").toBe(cap);
  expect(d.stats().calls, "calls started while the cap is held").toBe(cap);
  let done = false;
  const finished = p.finally(() => (done = true));
  while (!done) {
    d.release();
    await tick();
  }
  const out = await finished;
  d.stopHolding();
  const { calls, bytes, maxInFlight } = d.stats();
  report(label, calls, bytes, Math.round(performance.now() - t0));
  return { out, calls, bytes, maxInFlight };
}

describe("what each screen costs (calls and concurrency are exact; times are only printed)", () => {
  it("the pool size is the documented one", () => {
    expect(BATCH_CONCURRENCY).toBe(4); // docs/performance.md and docs/operations.md quote it
  });

  it("search, albums step, pressings, release card, list page: cold, then warm", async () => {
    const s = await import("@/server/discogs/service");
    const d = discogs();
    const deps = { db, fetchImpl: d.fetchImpl as unknown as typeof fetch, sleep: async () => {}, random: () => 0.5 };

    const searchCold = await measure("search (cold)", d, () => s.searchDiscogs(deps, { mode: "artist", query: "perf artist", page: 1 }));
    expect(searchCold.calls).toBe(1);
    const searchWarm = await measure("search (warm)", d, () => s.searchDiscogs(deps, { mode: "artist", query: "perf artist", page: 1 }));
    expect(searchWarm.calls).toBe(0);

    const ids = Array.from({ length: 12 }, (_, i) => 500 + i);
    const albumsCold = await measureGated("albums step: 12 masters (cold)", d, BATCH_CONCURRENCY, () => s.getMasters(deps, ids));
    expect(albumsCold.calls).toBe(12); // one call per master, no more
    expect(albumsCold.maxInFlight).toBe(BATCH_CONCURRENCY); // concurrent (not a serial loop) and never above the pool size
    const albumsWarm = await measure("albums step: 12 masters (warm)", d, () => s.getMasters(deps, ids));
    expect(albumsWarm.calls).toBe(0);

    const versionsCold = await measure("pressings list (cold)", d, () => s.getMasterVersions(deps, { masterId: 500, page: 1 }));
    expect(versionsCold.calls).toBe(1);
    const versionsWarm = await measure("pressings list (warm)", d, () => s.getMasterVersions(deps, { masterId: 500, page: 1 }));
    expect(versionsWarm.calls).toBe(0);

    const cardCold = await measure("release card (cold)", d, () => s.getRelease(deps, 1001));
    expect(cardCold.calls).toBe(1);
    const cardWarm = await measure("release card (warm)", d, () => s.getRelease(deps, 1001));
    expect(cardWarm.calls).toBe(0);

    // The bucket starts with 25 tokens and the screens above spent 15: refill it, so what is measured is the screen, not the budget
    // (the budget itself is tested in token-bucket.test.ts and chaos-discogs.test.ts).
    await db.delete(discogsBucket);
    const list = Array.from({ length: 24 }, (_, i) => 3000 + i);
    const pageCold = await measureGated("list page: 24 releases (cold)", d, BATCH_CONCURRENCY, () => s.getReleases(deps, list));
    expect(pageCold.calls).toBe(24); // the large page size: one call per uncached record
    expect(pageCold.maxInFlight).toBe(BATCH_CONCURRENCY);
    const pageWarm = await measure("list page: 24 releases (warm)", d, () => s.getReleases(deps, list));
    expect(pageWarm.calls).toBe(0);
    await db.delete(discogsBucket);
    const pageNext = await measure("list page 2: 12 new releases", d, () => s.getReleases(deps, Array.from({ length: 12 }, (_, i) => 4000 + i)));
    expect(pageNext.calls).toBe(12); // the next page asks only for its own records
  });

  it("a whole finder journey (search, albums, pressings, card) costs 15 Discogs calls cold and none when repeated", async () => {
    const s = await import("@/server/discogs/service");
    const d = discogs();
    const deps = { db, fetchImpl: d.fetchImpl as unknown as typeof fetch, sleep: async () => {}, random: () => 0.5 };
    const journey = async () => {
      await s.searchDiscogs(deps, { mode: "artist", query: "journey", page: 1 });
      await s.getMasters(deps, Array.from({ length: 12 }, (_, i) => 600 + i));
      await s.getMasterVersions(deps, { masterId: 600, page: 1 });
      await s.getRelease(deps, 2001);
    };
    const first = await measure("finder journey (cold)", d, journey);
    expect(first.calls).toBe(1 + 12 + 1 + 1);
    const second = await measure("finder journey (repeated: Back/reload)", d, journey);
    expect(second.calls).toBe(0); // a Back or a reload within the TTL costs the shared budget nothing
  });
});
