import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { discogsBucket, discogsCache } from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";
import { createTestDb } from "../helpers/pglite";
import { setEnv } from "../helpers/env";

/** The per-minute counters: events only, one line, nothing that identifies anyone, and they follow what really happened. */

let db: AppDb;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());
beforeEach(async () => {
  vi.resetModules();
  setEnv({ DISCOGS_API_BASE: "http://discogs.test" });
  await db.delete(discogsCache);
  await db.delete(discogsBucket);
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("metrics", () => {
  it("writes ONE line, with fixed names and numbers only, and nothing when nothing happened", async () => {
    const m = await import("@/server/metrics");
    expect(m.takeSnapshot()).toBeNull();
    m.count("discogs_calls", 3);
    m.count("cache_hits");
    const line = m.takeSnapshot()!;
    expect(line).toBe("[metrics] window=60s discogs_calls=3 cache_hits=1 cache_misses=0 throttled=0 cap_hits=0 upstream_errors=0");
    expect(line).not.toMatch(/\n/);
    expect(m.takeSnapshot()).toBeNull(); // the counters were reset by the snapshot
  });

  it("is written to the log by flush(), and only when there is something to say", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const m = await import("@/server/metrics");
    m.flush();
    expect(log).not.toHaveBeenCalled();
    m.count("throttled");
    m.flush();
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toMatch(/^\[metrics\] window=60s .*throttled=1/);
    log.mockRestore();
  });

  it("counts cache hits, misses, Discogs calls, a throttle and a cap hit as they really happen", async () => {
    const m = await import("@/server/metrics");
    const service = await import("@/server/discogs/service");
    m.takeSnapshot();
    const fetchImpl = vi.fn(async () => json({ pagination: { page: 1, pages: 1, per_page: 50, items: 0 }, results: [] }));
    const deps = { db, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {}, random: () => 0.5 };

    await service.searchDiscogs(deps, { mode: "artist", query: "metrics one", page: 1 }); // miss + one call
    await service.searchDiscogs(deps, { mode: "artist", query: "metrics one", page: 1 }); // hit
    await service.searchDiscogs({ ...deps, coldLimit: async () => ({ allowed: false, retryAfter: 9 }) }, { mode: "artist", query: "metrics two", page: 1 }); // miss, refused
    expect(m.peek()).toMatchObject({ discogs_calls: 1, cache_hits: 1, cache_misses: 2, cap_hits: 1, throttled: 0, upstream_errors: 0 });

    const failing = { ...deps, fetchImpl: vi.fn(async () => json({}, 500)) as unknown as typeof fetch, maxRetries: 1 };
    await service.searchDiscogs(failing, { mode: "artist", query: "metrics three", page: 1 });
    expect(m.peek().upstream_errors).toBe(1);

    const limited = { ...deps, fetchImpl: vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "30" } })) as unknown as typeof fetch };
    await service.searchDiscogs(limited, { mode: "artist", query: "metrics four", page: 1 });
    expect(m.peek().throttled).toBeGreaterThanOrEqual(1);
  });

  it("counts a batch: hits and misses per record, one call per uncached record", async () => {
    const m = await import("@/server/metrics");
    const service = await import("@/server/discogs/service");
    m.takeSnapshot();
    const fetchImpl = vi.fn(async (u: URL) => json({ id: Number(u.pathname.split("/").pop()), title: "Synthetic", formats: [{ name: "Vinyl", qty: 1 }] }));
    const deps = { db, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {}, random: () => 0.5 };
    await service.getReleases(deps, [1, 2, 3]); // all cold
    await service.getReleases(deps, [1, 2, 3, 4]); // three warm, one cold
    expect(m.peek()).toMatchObject({ discogs_calls: 4, cache_hits: 3, cache_misses: 4 });
  });

  it("carries no personal data: the names are fixed and the values are integers", async () => {
    const m = await import("@/server/metrics");
    for (const name of m.METRIC_NAMES) m.count(name, 2);
    const line = m.takeSnapshot()!;
    expect(line.replace(/^\[metrics\] window=60s /, "").split(" ").every((kv) => /^[a-z_]+=\d+$/.test(kv))).toBe(true);
  });
});
