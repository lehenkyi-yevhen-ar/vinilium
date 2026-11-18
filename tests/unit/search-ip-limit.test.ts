import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { discogsBucket, discogsCache, rateLimit } from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";
import { createTestDb } from "../helpers/pglite";
import { setEnv } from "../helpers/env";

/**
 * The per-IP search limit, split in two (limits().search): a loose ceiling on ALL requests, and the IP's allowance for COLD
 * requests (those that need a Discogs call). A browser Back, a reload or a copied link re-asks for pages that are already cached;
 * that must not use up the cold allowance and must not call Discogs. Runs the real route handlers on PGlite with a fake fetch.
 */

let db: AppDb;
let close: () => Promise<void>;
const getSession = vi.fn();
vi.mock("@/server/db", () => ({ getDb: () => db }));
vi.mock("@/server/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let upstream: ReturnType<typeof vi.fn>;

beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());
beforeEach(async () => {
  vi.resetModules();
  await db.delete(rateLimit);
  await db.delete(discogsCache);
  await db.delete(discogsBucket);
  getSession.mockReset();
  getSession.mockImplementation(async () => ({ user: { id: "user-1" } }));
  upstream = vi.fn(async (u: URL | string) => {
    const url = new URL(String(u));
    if (url.pathname.startsWith("/masters/")) return json({ id: Number(url.pathname.split("/")[2]), title: "Synthetic album", year: 2000 });
    return json({ pagination: { page: 1, pages: 1, per_page: 50, items: 0 }, results: [] });
  });
  vi.stubGlobal("fetch", upstream);
});

/** The search IP limit is `ip` cold requests a minute and 4 x `ip` requests of any kind. The user limit is lifted out of the way. */
const configure = (ip: number) => setEnv({ RL_SEARCH_IP_PER_MIN: String(ip), RL_SEARCH_USER_PER_MIN: "10000", DISCOGS_API_BASE: "http://discogs.test" });

const headers = (ip: string) => ({ cookie: "better-auth.session_token=abc", "x-forwarded-for": ip });
async function search(q: string, ip = "198.51.100.7") {
  const { GET } = await import("@/app/api/discogs/search/route");
  return GET(new Request(`http://localhost/api/discogs/search?mode=artist&q=${encodeURIComponent(q)}`, { headers: headers(ip) }));
}
async function masters(ids: number[], ip = "198.51.100.7") {
  const { GET } = await import("@/app/api/discogs/masters/route");
  return GET(new Request(`http://localhost/api/discogs/masters?ids=${ids.join(",")}`, { headers: headers(ip) }));
}
const counter = async (key: string) => (await db.select().from(rateLimit)).find((r) => r.key === `app:${key}`)?.count ?? 0;

describe("Back / reload restores", () => {
  it("are answered from the cache: no Discogs call, and they do not use up the IP's cold allowance", async () => {
    configure(5); // 5 cold requests and 20 requests of any kind per minute
    expect((await search("restore me")).status).toBe(200); // the first look is cold: one Discogs call
    expect(upstream).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 15; i++) {
      const res = await search("restore me"); // Back, reload, a copied link: the same page again
      expect(res.status).toBe(200);
      expect((await res.json()).cached).toBe(true);
    }
    expect(upstream).toHaveBeenCalledTimes(1); // the shared Discogs budget was not touched by any of them
    expect(await counter("search:ip:198.51.100.7")).toBe(16); // all 16 count toward the flood ceiling ...
    expect(await counter("search:ipcold:198.51.100.7")).toBe(1); // ... but only the first one spent cold allowance

    // so the allowance is still there for NEW searches: 4 more cold ones are fine
    for (let i = 0; i < 4; i++) expect((await search(`something new ${i}`)).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(5);
  });
});

describe("the cold allowance still protects the shared Discogs budget", () => {
  it("refuses the request after the allowance, as 'throttled' with a countdown, and calls Discogs for none of them", async () => {
    configure(3);
    for (let i = 0; i < 3; i++) expect((await search(`cold ${i}`)).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(3);

    const refused = await search("cold 3"); // the fourth DIFFERENT (uncached) search from this IP in a minute
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: "throttled", scope: "discogs" });
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(Number(refused.headers.get("retry-after"))).toBeLessThanOrEqual(60);
    expect(upstream).toHaveBeenCalledTimes(3); // nothing was sent upstream

    // what is cached keeps working while the cold allowance is spent
    expect((await search("cold 1")).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(3);
  });

  it("is shared by everybody behind one address, and does not touch another address", async () => {
    configure(2);
    getSession.mockImplementation(async () => ({ user: { id: "alice" } }));
    expect((await search("a")).status).toBe(200);
    getSession.mockImplementation(async () => ({ user: { id: "bob" } }));
    expect((await search("b")).status).toBe(200);
    getSession.mockImplementation(async () => ({ user: { id: "carol" } }));
    expect((await search("c")).status).toBe(429); // third person, same IP: the shared allowance (2) is spent
    expect((await search("c", "198.51.100.99")).status).toBe(200); // another address is not affected
  });

  it("charges a batch once per request, not once per record (the per-person cap still counts each record)", async () => {
    configure(3);
    const ids = Array.from({ length: 12 }, (_, i) => 700 + i);
    const res = await masters(ids);
    expect(res.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(12);
    expect(await counter("search:ipcold:198.51.100.7")).toBe(1);
    expect(await counter("cold:user:user-1")).toBe(12);

    const again = await masters(ids); // fully cached
    expect(again.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(12);
    expect(await counter("search:ipcold:198.51.100.7")).toBe(1); // a warm batch costs nothing
  });

  it("a refused cold allowance stops a batch before any record is fetched", async () => {
    configure(1);
    expect((await search("uses the one")).status).toBe(200);
    const res = await masters([801, 802, 803]);
    expect(res.status).toBe(200); // batches answer 200 with the records they could not resolve listed as missing
    const body = await res.json();
    expect(body.data.masters).toEqual([]);
    expect(body.data.missing).toEqual([801, 802, 803]);
    expect(body.data.retryAfter).toBeGreaterThanOrEqual(1);
    expect(upstream).toHaveBeenCalledTimes(1); // only the search
  });
});

describe("the flood ceiling protects our own database", () => {
  it("counts every request, cached or not, and answers 429 'rate_limited' with Retry-After past 4 x the cold allowance", async () => {
    configure(1); // flood ceiling: 4 requests a minute
    for (let i = 0; i < 4; i++) expect((await search("same page")).status).toBe(200);
    const blocked = await search("same page");
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ error: "rate_limited", scope: "app" });
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect((await search("same page", "198.51.100.50")).status).toBe(200); // other address unaffected
  });

  it("defaults: 30 cold requests and 120 requests of any kind per IP and minute", async () => {
    setEnv();
    const { limits } = await import("@/server/limits");
    expect(limits().search).toMatchObject({ ip: 30, ipAll: 120, user: 60 });
  });
});
