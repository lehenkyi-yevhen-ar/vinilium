import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { discogsBucket, discogsCache, rateLimit } from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";
import { createTestDb } from "../helpers/pglite";
import { setEnv } from "../helpers/env";

/** The per-person cap on COLD Discogs fetches: over it, a batch stops and reports `missing` + `retryAfter`, like a Discogs throttle. */

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const release = (id: number) => ({ id, title: `Record ${id}`, uri: `https://www.discogs.com/release/${id}-R`, artists: [{ name: "A" }], formats: [{ name: "Vinyl", qty: 1, descriptions: ["LP"] }] });

let db: AppDb;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());
beforeEach(async () => {
  vi.resetModules();
  setEnv();
  await db.delete(discogsCache);
  await db.delete(discogsBucket);
  await db.delete(rateLimit);
});

async function svc(limit: number, userId = "u1") {
  const service = await import("@/server/discogs/service");
  const { coldLimiter } = await import("@/server/discogs/cold-limit");
  const fetchImpl = vi.fn(async (u: URL) => json(release(Number(u.pathname.split("/").pop()))));
  const deps = { db, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {}, random: () => 0.5, coldLimit: coldLimiter(db, userId, { limit }) };
  return { ...service, deps, fetchImpl, coldLimiter };
}

describe("coldLimiter", () => {
  it("allows the limit, then refuses with a retryAfter inside the window; another person is unaffected", async () => {
    const { coldLimiter } = await import("@/server/discogs/cold-limit");
    const a = coldLimiter(db, "alice", { limit: 3, now: () => 1_000_000 });
    const b = coldLimiter(db, "bob", { limit: 3, now: () => 1_000_000 });
    expect((await a()).allowed && (await a()).allowed && (await a()).allowed).toBe(true);
    const over = await a();
    expect(over.allowed).toBe(false);
    expect(over.retryAfter).toBeGreaterThanOrEqual(1);
    expect(over.retryAfter).toBeLessThanOrEqual(60);
    expect((await b()).allowed).toBe(true);
  });

  it("starts again after the window", async () => {
    const { coldLimiter } = await import("@/server/discogs/cold-limit");
    let now = 5_000_000;
    const a = coldLimiter(db, "alice", { limit: 1, now: () => now });
    expect((await a()).allowed).toBe(true);
    expect((await a()).allowed).toBe(false);
    now += 61_000;
    expect((await a()).allowed).toBe(true);
  });

  it("defaults to 24 a minute (two cold pages of 12), overridable by RL_COLD_USER_PER_MIN", async () => {
    const { limits } = await import("@/server/limits");
    expect(limits().coldFetch.user).toBe(24);
    vi.resetModules();
    setEnv({ RL_COLD_USER_PER_MIN: "5" });
    expect((await import("@/server/limits")).limits().coldFetch.user).toBe(5);
  });
});

describe("a batch at the cap", () => {
  it("fetches only what the allowance covers, and reports the rest as missing with a retryAfter (no error)", async () => {
    const s = await svc(5);
    const ids = Array.from({ length: 12 }, (_, i) => 500 + i);
    const r = await s.getReleases(s.deps, ids);
    if (!r.ok) throw new Error("must not be an error");
    expect(r.data.releases).toHaveLength(5);
    expect(s.fetchImpl).toHaveBeenCalledTimes(5);
    expect(r.data.missing).toHaveLength(7);
    expect(r.data.retryAfter).toBeGreaterThanOrEqual(1);
    expect(r.data.gone).toEqual([]);
  });

  it("cached records are free: a warm page never touches the allowance", async () => {
    const warm = await svc(100);
    const ids = Array.from({ length: 12 }, (_, i) => 700 + i);
    await warm.getReleases(warm.deps, ids); // 12 cold fetches fill the cache
    const capped = await svc(0); // a person with NO allowance left
    const r = await capped.getReleases(capped.deps, ids);
    if (!r.ok) throw new Error("failed");
    expect(r.data.releases).toHaveLength(12);
    expect(r.data.missing).toEqual([]);
    expect(r.cached).toBe(true);
    expect(capped.fetchImpl).not.toHaveBeenCalled();
  });

  it("is per person: one person at the cap does not stop another from fetching", async () => {
    const alice = await svc(2, "alice");
    const bob = await svc(2, "bob");
    const a = await alice.getReleases(alice.deps, [1, 2, 3, 4]);
    const b = await bob.getReleases(bob.deps, [11, 12]);
    if (!a.ok || !b.ok) throw new Error("failed");
    expect(a.data.missing.length).toBe(2);
    expect(b.data.missing).toEqual([]);
  });

  it("applies to the albums step (masters) as well", async () => {
    const service = await import("@/server/discogs/service");
    const { coldLimiter } = await import("@/server/discogs/cold-limit");
    const fetchImpl = vi.fn(async (u: URL) => json({ id: Number(u.pathname.split("/").pop()), title: "Album", year: 2000, uri: "https://www.discogs.com/master/1", artists: [{ name: "A" }] }));
    const deps = { db, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {}, random: () => 0.5, coldLimit: coldLimiter(db, "u9", { limit: 3 }) };
    const r = await service.getMasters(deps, Array.from({ length: 8 }, (_, i) => 900 + i));
    if (!r.ok) throw new Error("failed");
    expect(r.data.masters).toHaveLength(3);
    expect(r.data.missing).toHaveLength(5);
    expect(r.data.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it("without a limiter the batch behaves exactly as before", async () => {
    const service = await import("@/server/discogs/service");
    const fetchImpl = vi.fn(async (u: URL) => json(release(Number(u.pathname.split("/").pop()))));
    const r = await service.getReleases({ db, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {}, random: () => 0.5 }, [1, 2, 3]);
    if (!r.ok) throw new Error("failed");
    expect(r.data.releases).toHaveLength(3);
  });
});
