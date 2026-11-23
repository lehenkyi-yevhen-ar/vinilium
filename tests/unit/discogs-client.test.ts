import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { discogsBucket } from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";
import { createTestDb } from "../helpers/pglite";
import { setEnv } from "../helpers/env";

let db: AppDb;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());

let clockBase = 100_000_000;
beforeEach(async () => {
  vi.resetModules();
  setEnv();
  await db.delete(discogsBucket); // every test starts from a fresh bucket
});

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
const status = (code: number, headers: Record<string, string> = {}) => new Response("", { status: code, headers });

/** Deterministic harness: fake fetch queue, fake clock that sleeping advances, fixed "random". */
async function harness(queue: Array<Response | Error>) {
  const { discogsGet } = await import("@/server/discogs/client");
  let t = (clockBase += 10_000_000); // monotonic fake clock, far apart between tests
  const sleeps: number[] = [];
  const fetchImpl = vi.fn(async (..._args: unknown[]) => {
    const next = queue.shift();
    if (!next) throw new Error("fetch queue empty");
    if (next instanceof Error) throw next;
    return next;
  });
  const deps = {
    db,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    now: () => t,
    random: () => 0.5,
  };
  return { discogsGet: (path: string, params: Record<string, string | number> = {}) => discogsGet(path, params, deps), fetchImpl, sleeps, deps, clock: () => t };
}

describe("discogsGet: request shape", () => {
  it("authenticates with key + secret, sends a descriptive User-Agent, and builds the URL", async () => {
    const h = await harness([json({ ok: 1 })]);
    const out = await h.discogsGet("/database/search", { q: "cobalt parade", type: "master", per_page: 50 });
    expect(out.ok).toBe(true);

    const [url, init] = h.fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://api.discogs.com/database/search?q=cobalt+parade&type=master&per_page=50");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Discogs key=test-key, secret=test-secret");
    expect(headers["User-Agent"]).toBe("Vinilium/0.1 (+https://vinilium.test/contact)");
    expect(headers.Accept).toContain("discogs");
    expect(init.cache).toBe("no-store");
  });

  it("prefers key/secret over the personal token when both are set", async () => {
    setEnv({ DISCOGS_TOKEN: "tok-123" });
    const h = await harness([json({})]);
    await h.discogsGet("/x");
    const headers = (h.fetchImpl.mock.calls[0] as [URL, RequestInit])[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Discogs key=test-key, secret=test-secret");
  });

  it("falls back to the token when no key/secret pair is configured", async () => {
    setEnv({ DISCOGS_TOKEN: "tok-123", DISCOGS_CONSUMER_KEY: "", DISCOGS_CONSUMER_SECRET: "" });
    const h = await harness([json({})]);
    await h.discogsGet("/x");
    const headers = (h.fetchImpl.mock.calls[0] as [URL, RequestInit])[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Discogs token=tok-123");
  });

  it("reports 'unconfigured' without calling Discogs when there are no credentials", async () => {
    setEnv({ DISCOGS_CONSUMER_KEY: "", DISCOGS_CONSUMER_SECRET: "" });
    const h = await harness([]);
    expect(await h.discogsGet("/x")).toEqual({ ok: false, kind: "unconfigured" });
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it("uses an email contact in the User-Agent when APP_CONTACT is not a URL", async () => {
    setEnv({ APP_CONTACT: "me@example.com" });
    const h = await harness([json({})]);
    await h.discogsGet("/x");
    const headers = (h.fetchImpl.mock.calls[0] as [URL, RequestInit])[1].headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe("Vinilium/0.1 (contact: me@example.com)");
  });

  it("never names the placeholder contact: an unset (or placeholder) APP_CONTACT falls back to this site's contact page", async () => {
    setEnv({ APP_CONTACT: "https://example.com/contact", NEXT_PUBLIC_APP_URL: "https://vinilium.example.test/" });
    const h = await harness([json({})]);
    await h.discogsGet("/x");
    const headers = (h.fetchImpl.mock.calls[0] as [URL, RequestInit])[1].headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe("Vinilium/0.1 (+https://vinilium.example.test/en/contact)");
    expect(headers["User-Agent"]).not.toContain("example.com");
  });
});

describe("discogsGet: rate-limit headers", () => {
  it("reads X-Discogs-Ratelimit-* and stores the REAL limit (not a hard-coded one)", async () => {
    const h = await harness([
      json({}, { headers: { "x-discogs-ratelimit": "60", "x-discogs-ratelimit-used": "4", "x-discogs-ratelimit-remaining": "56" } }),
    ]);
    const out = await h.discogsGet("/x");
    expect(out.ok && out.rate).toEqual({ limit: 60, used: 4, remaining: 56 });

    const { readBucket } = await import("@/server/discogs/token-bucket");
    const { bucketId } = await import("@/server/discogs/config");
    const row = await readBucket(db, bucketId());
    expect(row).toMatchObject({ capacity: 60, observedLimit: 60, observedRemaining: 56 });
  });

  it("follows the limit if Discogs lowers it", async () => {
    const h = await harness([json({}, { headers: { "x-discogs-ratelimit": "20", "x-discogs-ratelimit-remaining": "19" } })]);
    await h.discogsGet("/x");
    const { readBucket } = await import("@/server/discogs/token-bucket");
    const { bucketId } = await import("@/server/discogs/config");
    expect((await readBucket(db, bucketId()))!.capacity).toBe(20);
  });
});

describe("discogsGet: 429 handling (backoff + jitter)", () => {
  it("backs off with jitter, then succeeds", async () => {
    const h = await harness([status(429), json({ ok: true })]);
    const out = await h.discogsGet("/x");
    expect(out.ok).toBe(true);
    expect(h.fetchImpl).toHaveBeenCalledTimes(2);
    expect(h.sleeps).toEqual([1000]); // random 0.5 * 1000 = 500, floored to the 1 s minimum
  });

  it("honours Retry-After as a floor", async () => {
    const h = await harness([status(429, { "retry-after": "2" }), json({})]);
    expect((await h.discogsGet("/x")).ok).toBe(true);
    expect(h.sleeps).toEqual([2000]);
  });

  it("grows the backoff exponentially across attempts and finally reports 'throttled' with retryAfter", async () => {
    const h = await harness([status(429), status(429), status(429), status(429)]);
    const out = await h.discogsGet("/x");
    expect(out).toEqual({ ok: false, kind: "throttled", retryAfter: 4 });
    expect(h.fetchImpl).toHaveBeenCalledTimes(4);
    expect(h.sleeps).toEqual([1000, 1000, 2000]); // 0.5 * min(8000, 1000 * 2^attempt), floor 1000
  });

  it("does not sleep through a long Retry-After: it reports throttled so the UI can show a countdown", async () => {
    const h = await harness([status(429, { "retry-after": "120" })]);
    const out = await h.discogsGet("/x");
    expect(out).toEqual({ ok: false, kind: "throttled", retryAfter: 120 });
    expect(h.sleeps).toEqual([]);
  });

  it("shares the block across callers: the next request is refused locally, without touching Discogs", async () => {
    const h = await harness([status(429, { "retry-after": "120" })]);
    await h.discogsGet("/x");
    const again = await h.discogsGet("/y");
    expect(again.ok).toBe(false);
    if (!again.ok && again.kind === "throttled") expect(again.retryAfter).toBeGreaterThan(100);
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("applies jitter: different random values give different delays", async () => {
    const { backoffMs } = await import("@/server/discogs/client");
    expect(backoffMs(2, () => 0)).toBe(0);
    expect(backoffMs(2, () => 1)).toBe(4000);
    expect(backoffMs(10, () => 1)).toBe(8000); // capped
  });

  it("parses Retry-After as seconds or an HTTP date", async () => {
    const { parseRetryAfter } = await import("@/server/discogs/client");
    expect(parseRetryAfter("7", 0)).toBe(7);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6);
    expect(parseRetryAfter("soon", 0)).toBeNull();
    expect(parseRetryAfter(null, 0)).toBeNull();
  });
});

describe("discogsGet: our own budget", () => {
  it("waits briefly for a token when the wait is short", async () => {
    const h = await harness([json({})]);
    const { acquireToken } = await import("@/server/discogs/token-bucket");
    const { bucketId } = await import("@/server/discogs/config");
    for (let i = 0; i < 25; i++) await acquireToken(db, { id: bucketId(), now: h.clock() });
    const out = await h.discogsGet("/x");
    expect(out.ok).toBe(true);
    expect(h.sleeps[0]).toBeGreaterThanOrEqual(2400);
  });

  it("returns 'throttled' (no request made) when the next token is far away", async () => {
    const h = await harness([json({})]);
    const { recordObserved, acquireToken } = await import("@/server/discogs/token-bucket");
    const { bucketId } = await import("@/server/discogs/config");
    await recordObserved(db, { id: bucketId(), limit: 6, used: 6, remaining: 6, now: h.clock() }); // 6/min = 1 per 10 s
    for (let i = 0; i < 6; i++) await acquireToken(db, { id: bucketId(), now: h.clock() });
    const out = await h.discogsGet("/x");
    expect(out).toEqual({ ok: false, kind: "throttled", retryAfter: 10 });
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });
});

describe("discogsGet: other outcomes", () => {
  it("maps 404 to not_found", async () => {
    const h = await harness([status(404)]);
    expect(await h.discogsGet("/releases/1")).toEqual({ ok: false, kind: "not_found" });
  });

  it("retries a 5xx once with backoff and then succeeds", async () => {
    const h = await harness([status(503), json({ ok: true })]);
    expect((await h.discogsGet("/x")).ok).toBe(true);
    expect(h.sleeps).toHaveLength(1);
  });

  it("gives up on persistent 5xx", async () => {
    const h = await harness([status(500), status(500), status(500)]);
    expect(await h.discogsGet("/x")).toEqual({ ok: false, kind: "upstream", status: 500 });
  });

  it("treats an auth failure as upstream (no retry)", async () => {
    const h = await harness([status(401)]);
    expect(await h.discogsGet("/x")).toEqual({ ok: false, kind: "upstream", status: 401 });
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("survives a network error by retrying", async () => {
    const h = await harness([new Error("ECONNRESET"), json({ ok: true })]);
    expect((await h.discogsGet("/x")).ok).toBe(true);
  });
});
