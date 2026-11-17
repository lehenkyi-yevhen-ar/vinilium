import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimit } from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";
import { createTestDb } from "../helpers/pglite";
import { setEnv } from "../helpers/env";

let db: AppDb;
let close: () => Promise<void>;
const getSession = vi.fn();

vi.mock("@/server/db", () => ({ getDb: () => db }));
vi.mock("@/server/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));

beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());
beforeEach(async () => {
  vi.resetModules();
  getSession.mockReset();
  await db.delete(rateLimit);
  setEnv({ RL_SEARCH_IP_PER_MIN: "2", RL_SEARCH_USER_PER_MIN: "3", RL_IMAGE_IP_PER_MIN: "2", RL_IMAGE_USER_PER_MIN: "3" });
});

const COOKIE = "better-auth.session_token=abc";
const req = (headers: Record<string, string> = {}) => new Request("http://localhost/api/discogs/search", { headers });
const signedIn = (id = "user-1") => getSession.mockResolvedValue({ user: { id } });

describe("guard: sign-in required, then per-IP and per-user limits", () => {
  it("answers 401 'unauthorized' to anonymous callers, without a database lookup or a limiter hit", async () => {
    const { guard } = await import("@/server/discogs/http");
    const res = await guard(req({ "x-forwarded-for": "198.51.100.7" }), "search"); // no cookie
    expect(res?.status).toBe(401);
    expect(await res?.json()).toMatchObject({ error: "unauthorized" });
    expect(getSession).not.toHaveBeenCalled();
    expect(await db.select().from(rateLimit)).toHaveLength(0);
  });

  it("answers 401 when the cookie does not belong to a live session, or the lookup fails", async () => {
    const { guard } = await import("@/server/discogs/http");
    getSession.mockResolvedValue(null);
    expect((await guard(req({ cookie: COOKIE }), "search"))?.status).toBe(401);
    getSession.mockRejectedValue(new Error("db down"));
    expect((await guard(req({ cookie: COOKIE }), "search"))?.status).toBe(401);
  });

  it("limits a signed-in caller by IP", async () => {
    signedIn();
    const { guard } = await import("@/server/discogs/http");
    const call = (id: string) => {
      getSession.mockResolvedValue({ user: { id } });
      return guard(req({ cookie: COOKIE, "x-forwarded-for": "198.51.100.7" }), "search");
    };
    expect(await call("a")).toBeNull();
    expect(await call("b")).toBeNull();
    const blocked = await call("c"); // three different users behind one IP: the IP limit (2) stops it
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(await blocked?.json()).toMatchObject({ error: "rate_limited", scope: "app" });
  });

  it("limits a signed-in user across different IPs", async () => {
    signedIn();
    const { guard } = await import("@/server/discogs/http");
    const call = (n: number) => guard(req({ cookie: COOKIE, "x-forwarded-for": `198.51.100.${n}` }), "search");
    expect(await call(1)).toBeNull();
    expect(await call(2)).toBeNull();
    expect(await call(3)).toBeNull();
    expect((await call(4))?.status).toBe(429); // every IP is under its own limit; the USER limit (3) is what stops this
  });

  it("keeps search and image budgets separate", async () => {
    signedIn();
    const { guard } = await import("@/server/discogs/http");
    const h = { cookie: COOKIE, "x-forwarded-for": "198.51.100.9" };
    await guard(req(h), "search");
    await guard(req(h), "search");
    expect((await guard(req(h), "search"))?.status).toBe(429);
    expect(await guard(req(h), "image")).toBeNull();
  });

  it("refuses requests the browser labels cross-site (hotlinking / third-party pages) before anything else", async () => {
    signedIn();
    const { guard } = await import("@/server/discogs/http");
    const res = await guard(req({ cookie: COOKIE, "sec-fetch-site": "cross-site", "x-forwarded-for": "198.51.100.30" }), "image");
    expect(res?.status).toBe(403);
    expect(await res?.json()).toMatchObject({ error: "forbidden" });
    expect(getSession).not.toHaveBeenCalled();
    expect(await db.select().from(rateLimit)).toHaveLength(0);
    // our own pages (same-origin) are not affected
    expect(await guard(req({ cookie: COOKIE, "sec-fetch-site": "same-origin", "x-forwarded-for": "198.51.100.31" }), "image")).toBeNull();
  });
});

describe("respond: DiscogsResult -> HTTP", () => {
  it("returns data with no-store caching", async () => {
    const { respond } = await import("@/server/discogs/http");
    const res = respond({ ok: true, data: { a: 1 }, cached: true, fetchedAt: "2026-01-01T00:00:00.000Z" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ data: { a: 1 }, cached: true, fetchedAt: "2026-01-01T00:00:00.000Z" });
  });

  it("exposes the throttled state with retryAfter in the body AND the Retry-After header", async () => {
    const { respond } = await import("@/server/discogs/http");
    const res = respond({ ok: false, error: "throttled", retryAfter: 17 });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("17");
    expect(await res.json()).toEqual({ error: "throttled", scope: "discogs", retryAfter: 17 });
  });

  it("maps the other outcomes", async () => {
    const { respond } = await import("@/server/discogs/http");
    expect(respond({ ok: false, error: "not_found" }).status).toBe(404);
    expect(respond({ ok: false, error: "unconfigured" }).status).toBe(503);
    expect(respond({ ok: false, error: "upstream" }).status).toBe(502);
  });
});

describe("input schemas", () => {
  it("accepts 1 to 12 distinct master ids for the batch endpoint", async () => {
    const { masterIdsSchema } = await import("@/server/discogs/http");
    expect(masterIdsSchema.parse("910001,910002")).toEqual([910001, 910002]);
    expect(masterIdsSchema.parse("5,5,6")).toEqual([5, 6]);
    expect(masterIdsSchema.safeParse(Array.from({ length: 12 }, (_, i) => i + 1).join(",")).success).toBe(true);
    for (const bad of ["", "0", "a", "1,,2", "1,2,", Array.from({ length: 13 }, (_, i) => i + 1).join(","), "1;2", "-1"]) expect(masterIdsSchema.safeParse(bad).success, bad).toBe(false);
  });

  it("accepts only positive integer ids", async () => {
    const { idSchema } = await import("@/server/discogs/http");
    expect(idSchema.parse("951004")).toBe(951004);
    for (const bad of ["0", "-1", "1.5", "abc", "01", "12345678901", "1e3", " 1", ""]) expect(idSchema.safeParse(bad).success, bad).toBe(false);
  });

  it("normalises and bounds search input", async () => {
    const { searchQuerySchema } = await import("@/server/discogs/http");
    expect(searchQuerySchema.parse({ q: "  cobalt   parade ", mode: "artist" })).toEqual({ q: "cobalt parade", mode: "artist", by: undefined, page: 1 });
    expect(searchQuerySchema.parse({ q: "neon static", mode: "track", by: "  Mira   Vale " })).toEqual({ q: "neon static", mode: "track", by: "Mira Vale", page: 1 });
    expect(searchQuerySchema.parse({ q: "x", mode: "album", by: "" }).by).toBeUndefined();
    expect(searchQuerySchema.safeParse({ q: "x", mode: "track", by: "y".repeat(101) }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: "x", mode: "master" }).success).toBe(false); // masters are not searched
    expect(searchQuerySchema.safeParse({ q: "x", mode: "artist", page: "6" }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: "   ", mode: "artist" }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: "x", mode: "label" }).success).toBe(false);
  });

  it("accepts version filters: country and label as text, released as a four-digit year, blanks ignored", async () => {
    const { versionsQuerySchema } = await import("@/server/discogs/http");
    expect(versionsQuerySchema.parse({ country: " UK ", released: "2001", label: "Virgin" })).toEqual({ page: 1, country: "UK", released: "2001", label: "Virgin" });
    expect(versionsQuerySchema.parse({ country: "", released: "", label: "" })).toEqual({ page: 1, country: undefined, released: undefined, label: undefined });
    expect(versionsQuerySchema.safeParse({ released: "20x1" }).success).toBe(false);
    expect(versionsQuerySchema.safeParse({ country: "x".repeat(101) }).success).toBe(false);
  });
});
