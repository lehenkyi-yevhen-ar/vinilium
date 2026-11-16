import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acquireToken,
  applyObserved,
  blockFor,
  DEFAULT_CAPACITY,
  initialState,
  parseRateHeaders,
  readBucket,
  recordObserved,
  refill,
  take,
  type AppDb,
} from "@/server/discogs/token-bucket";
import { createTestDb } from "../helpers/pglite";

describe("token bucket math (pure)", () => {
  const t0 = 1_000_000;

  it("starts on a conservative default, NOT a hard-coded 60", () => {
    expect(DEFAULT_CAPACITY).toBe(25);
    expect(initialState(t0).capacity).toBe(25);
  });

  it("spends one token per request until empty, then reports when the next one arrives", () => {
    let s = initialState(t0);
    for (let i = 0; i < 25; i++) {
      const r = take(s, t0);
      expect(r.ok).toBe(true);
      s = r.state;
    }
    const denied = take(s, t0);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.retryAfterSec).toBe(3); // 1 token at 25/60 per s = 2.4 s -> 3
  });

  it("refills with time but never above capacity", () => {
    const empty = { ...initialState(t0), tokens: 0 };
    expect(refill(empty, t0 + 6_000).tokens).toBeCloseTo(2.5, 5);
    expect(refill(empty, t0 + 10 * 60_000).tokens).toBe(25);
  });

  it("keeps a reserve free for API calls when images draw tokens", () => {
    const s = { ...initialState(t0), tokens: 6 };
    expect(take(s, t0, 1, 6.25).ok).toBe(false); // 25% of 25 reserved
    expect(take(s, t0, 1, 5).ok).toBe(true);
  });

  it("refuses everything while blocked, and says for how long", () => {
    const s = { ...initialState(t0), blockedUntil: t0 + 4_200 };
    const r = take(s, t0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryAfterSec).toBe(5);
    expect(take(s, t0 + 4_300).ok).toBe(true);
  });

  it("adopts the limit Discogs reports and clamps tokens to what it says is left", () => {
    const s = applyObserved(initialState(t0), { limit: 60, remaining: 12 }, t0);
    expect(s.capacity).toBe(60);
    expect(s.refillPerSec).toBeCloseTo(1, 5);
    expect(s.tokens).toBe(12);
  });

  it("ignores nonsense header values", () => {
    const s = applyObserved(initialState(t0), { limit: 0, remaining: -5 }, t0);
    expect(s.capacity).toBe(25);
    const t = applyObserved(initialState(t0), { limit: null, remaining: null }, t0);
    expect(t.tokens).toBe(25);
  });

  it("parses X-Discogs-Ratelimit headers", () => {
    const h = new Headers({ "X-Discogs-Ratelimit": "60", "X-Discogs-Ratelimit-Used": "3", "X-Discogs-Ratelimit-Remaining": "57" });
    expect(parseRateHeaders(h)).toEqual({ limit: 60, used: 3, remaining: 57 });
    expect(parseRateHeaders(new Headers())).toEqual({ limit: null, used: null, remaining: null });
    expect(parseRateHeaders(new Headers({ "x-discogs-ratelimit": "abc" })).limit).toBeNull();
  });
});

describe("token bucket persistence (real SQL on PGlite)", () => {
  let db: AppDb;
  let close: () => Promise<void>;
  beforeAll(async () => ({ db, close } = await createTestDb()));
  afterAll(() => close());

  it("is shared and atomic: exactly `capacity` of many concurrent requests are admitted", async () => {
    const now = 5_000_000;
    const results = await Promise.all(Array.from({ length: 40 }, () => acquireToken(db, { id: "api:test-concurrent", now })));
    expect(results.filter((r) => r.ok)).toHaveLength(25);
    expect(results.filter((r) => !r.ok)).toHaveLength(15);
  });

  it("learns the real limit from headers and persists what it observed", async () => {
    const now = 6_000_000;
    await recordObserved(db, { id: "api:test-observed", limit: 60, used: 1, remaining: 59, now });
    const row = await readBucket(db, "api:test-observed");
    expect(row).toMatchObject({ capacity: 60, observedLimit: 60, observedRemaining: 59 });
    expect(row!.refillPerSec).toBeCloseTo(1, 5);
    // with the real limit known, 59 tokens are available right away
    const ok = await Promise.all(Array.from({ length: 70 }, () => acquireToken(db, { id: "api:test-observed", now })));
    expect(ok.filter((r) => r.ok)).toHaveLength(59);
  });

  it("blockFor stops every caller until the time has passed", async () => {
    const now = 7_000_000;
    await blockFor(db, { id: "api:test-blocked", seconds: 10, now });
    const during = await acquireToken(db, { id: "api:test-blocked", now: now + 2_000 });
    expect(during.ok).toBe(false);
    if (!during.ok) expect(during.retryAfterSec).toBe(8);
    // When the block ends only a trickle is available (1 probe token + refill since the 429), not a full bucket.
    const results = await Promise.all(Array.from({ length: 10 }, () => acquireToken(db, { id: "api:test-blocked", now: now + 10_500 })));
    expect(results.filter((r) => r.ok)).toHaveLength(5); // 1 probe token + 10.5 s of refill at 25/60 per s = ~5.4
  });

  it("keeps separate budgets per API origin", async () => {
    const now = 8_000_000;
    await Promise.all(Array.from({ length: 30 }, () => acquireToken(db, { id: "api:origin-a", now })));
    const b = await acquireToken(db, { id: "api:origin-b", now });
    expect(b.ok).toBe(true);
  });
});
