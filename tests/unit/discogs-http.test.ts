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

const req = (headers: Record<string, string> = {}) => new Request("http://localhost/api/discogs/search", { headers });

describe("guard: per-IP and per-user limits", () => {
  it("limits anonymous callers by IP and never touches the session store", async () => {
    const { guard } = await import("@/server/discogs/http");
    const h = { "x-forwarded-for": "198.51.100.7" };
    expect(await guard(req(h), "search")).toBeNull();
    expect(await guard(req(h), "search")).toBeNull();
    const blocked = await guard(req(h), "search");
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(await blocked?.json()).toMatchObject({ error: "rate_limited", scope: "app" });
    expect(getSession).not.toHaveBeenCalled(); // no cookie -> no database lookup
  });

  it("limits a signed-in user across different IPs", async () => {
    getSession.mockResolvedValue({ user: { id: "user-1" } });
    const { guard } = await import("@/server/discogs/http");
    const call = (n: number) => guard(req({ cookie: "better-auth.session_token=abc", "x-forwarded-for": `198.51.100.${n}` }), "search");
    expect(await call(1)).toBeNull();
    expect(await call(2)).toBeNull();
    expect(await call(3)).toBeNull();
    const blocked = await call(4); // every IP is under its own limit; the USER limit (3) is what stops this
    expect(blocked?.status).toBe(429);
    expect(await blocked?.json()).toMatchObject({ error: "rate_limited", scope: "app" });
  });

  it("refuses requests the browser labels cross-site (hotlinking / third-party pages) without touching the limiter", async () => {
    const { guard } = await import("@/server/discogs/http");
    const res = await guard(req({ "sec-fetch-site": "cross-site", "x-forwarded-for": "198.51.100.30" }), "image");
    expect(res?.status).toBe(403);
    expect(await res?.json()).toMatchObject({ error: "forbidden" });
    expect(await db.select().from(rateLimit)).toHaveLength(0);
    // our own pages (same-origin) and plain server-side calls (no header) are not affected
    expect(await guard(req({ "sec-fetch-site": "same-origin", "x-forwarded-for": "198.51.100.31" }), "image")).toBeNull();
    expect(await guard(req({ "x-forwarded-for": "198.51.100.32" }), "image")).toBeNull();
  });

  it("keeps search and image budgets separate", async () => {
    const { guard } = await import("@/server/discogs/http");
    const h = { "x-forwarded-for": "198.51.100.9" };
    await guard(req(h), "search");
    await guard(req(h), "search");
    expect((await guard(req(h), "search"))?.status).toBe(429);
    expect(await guard(req(h), "image")).toBeNull();
  });

  it("treats a failing session lookup as anonymous instead of failing the request", async () => {
    getSession.mockRejectedValue(new Error("db down"));
    const { guard } = await import("@/server/discogs/http");
    expect(await guard(req({ cookie: "better-auth.session_token=abc", "x-forwarded-for": "198.51.100.20" }), "search")).toBeNull();
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
  it("accepts only positive integer ids", async () => {
    const { idSchema } = await import("@/server/discogs/http");
    expect(idSchema.parse("951004")).toBe(951004);
    for (const bad of ["0", "-1", "1.5", "abc", "01", "12345678901", "1e3", " 1", ""]) expect(idSchema.safeParse(bad).success, bad).toBe(false);
  });

  it("normalises and bounds search input", async () => {
    const { searchQuerySchema } = await import("@/server/discogs/http");
    expect(searchQuerySchema.parse({ q: "  daft   punk ", mode: "artist" })).toEqual({ q: "cobalt parade", mode: "artist", page: 1 });
    expect(searchQuerySchema.safeParse({ q: "x", mode: "artist", page: "6" }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: "   ", mode: "artist" }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: "x", mode: "label" }).success).toBe(false);
  });
});
