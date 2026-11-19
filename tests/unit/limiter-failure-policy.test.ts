import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { discogsBucket, discogsCache, rateLimit } from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";
import { createTestDb } from "../helpers/pglite";
import { setEnv } from "../helpers/env";

/**
 * What happens when our own limiter cannot write its counter (database error). Before: an unhandled exception, so Next answered an empty 500 (a
 * missing thumbnail, the generic error screen, a failed list write). Now each caller fails in a DELIBERATE way, and never "open" where the limiter
 * protects something:
 *
 *   search, images, masters   -> 503 {error:"unavailable"} + Retry-After, no Discogs call            (fail CLOSED: shared 60/min budget, abuse)
 *   lists writes and export   -> 503 {error:"unavailable"} + Retry-After                              (fail CLOSED)
 *   cold-fetch allowance      -> "not allowed, retry in 2 s": the screen shows its waiting countdown (fail CLOSED: no uncounted Discogs call)
 *   /api/csp-report           -> 204, the report is dropped                                           (fail OPEN: it protects only log volume)
 *   Better Auth's own limiter -> not routed through hit(); it retries a lost creation race itself and a database error fails the request
 */

let db: AppDb;
let close: () => Promise<void>;
const getSession = vi.fn();
vi.mock("@/server/db", () => ({ getDb: () => db }));
vi.mock("@/server/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let upstream: ReturnType<typeof vi.fn>;

const breakCounters = async (when: string) => {
  await db.execute(sql.raw(`create or replace function zz_boom() returns trigger language plpgsql as $$ begin raise exception 'simulated outage' using errcode = '57P01'; end $$`));
  await db.execute(sql.raw(`create trigger zz_boom before insert on rate_limit for each row when (${when}) execute function zz_boom()`));
};
const ALL = "new.key like 'app:%'";

beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(() => close());
beforeEach(async () => {
  vi.resetModules();
  await db.execute(sql`drop trigger if exists zz_boom on rate_limit`);
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
  setEnv({ RL_SEARCH_IP_PER_MIN: "100", RL_SEARCH_USER_PER_MIN: "10000", DISCOGS_API_BASE: "http://discogs.test" });
});

const headers = { cookie: "better-auth.session_token=abc", "x-forwarded-for": "198.51.100.7" };
async function search(q = "failing limiter") {
  const { GET } = await import("@/app/api/discogs/search/route");
  return GET(new Request(`http://localhost/api/discogs/search?mode=artist&q=${encodeURIComponent(q)}`, { headers }));
}

describe("every counter write fails: fail CLOSED with a structured, retryable 503", () => {
  it("search: 503 unavailable, Retry-After, and nothing was sent to Discogs", async () => {
    await breakCounters(ALL);
    const res = await search();
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("2");
    expect(await res.json()).toMatchObject({ error: "unavailable", retryAfter: 2 });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("images: 503 unavailable, nothing fetched", async () => {
    await breakCounters(ALL);
    const { GET } = await import("@/app/api/discogs/image/route");
    const res = await GET(new Request(`http://localhost/api/discogs/image?u=${encodeURIComponent("https://i.discogs.com/x/cover.jpg")}`, { headers }));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("2");
    expect(await res.json()).toMatchObject({ error: "unavailable" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("masters (a batch): 503, nothing fetched", async () => {
    await breakCounters(ALL);
    const { GET } = await import("@/app/api/discogs/masters/route");
    const res = await GET(new Request("http://localhost/api/discogs/masters?ids=1,2,3", { headers }));
    expect(res.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("lists: a write or export behind a limit is refused with 503 (not let through, not a 500); a read without a limit is unaffected", async () => {
    await breakCounters(ALL);
    const { gateLists, WRITE_LIMIT } = await import("@/server/lists/gate");
    const write = await gateLists(new Request("http://localhost/api/lists/items", { method: "POST", headers }), { limit: WRITE_LIMIT });
    expect("response" in write && write.response.status).toBe(503);
    expect("response" in write && write.response.headers.get("retry-after")).toBe("2");
    const read = await gateLists(new Request("http://localhost/api/lists/items", { headers }));
    expect(read).toEqual({ userId: "user-1" });
  });

  it("it never answers 200 while the counters are down (no silent skip of the protection)", async () => {
    await breakCounters(ALL);
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await search(`q${i}`)).status);
    expect(statuses).toEqual([503, 503, 503, 503, 503]);
  });

  it("the CSP report endpoint fails OPEN: 204, the report is dropped", async () => {
    await breakCounters(ALL);
    const { POST } = await import("@/app/api/csp-report/route");
    const res = await POST(new Request("http://localhost/api/csp-report", { method: "POST", headers: { "content-type": "application/csp-report", "x-forwarded-for": "198.51.100.8" }, body: JSON.stringify({ "csp-report": { "violated-directive": "script-src" } }) }));
    expect(res.status).toBe(204);
  });
});

describe("only the cold-fetch counters fail: fail CLOSED as 'wait', cached answers keep working", () => {
  it("a cold search is answered 429 throttled (retry in 2 s) and Discogs is not called", async () => {
    await breakCounters("new.key like 'app:search:ipcold:%'");
    const res = await search("cold and unchecked");
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: "throttled", scope: "discogs", retryAfter: 2 });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("a search already in the cache is still answered 200 (it never needed the cold counter)", async () => {
    expect((await search("warm me")).status).toBe(200); // healthy: one Discogs call, cached
    expect(upstream).toHaveBeenCalledTimes(1);
    await breakCounters("new.key like 'app:search:ipcold:%'");
    expect((await search("warm me")).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("coldLimiter() itself: not allowed, retry in 2 s", async () => {
    await breakCounters("new.key like 'app:cold:user:%'");
    const { coldLimiter } = await import("@/server/discogs/cold-limit");
    expect(await coldLimiter(db, "user-1", { limit: 24 })()).toEqual({ allowed: false, retryAfter: 2 });
  });
});

describe("the client reads a 503 'unavailable' as a short-lived error, and only 'unconfigured' as 'not set up'", () => {
  it("fetchDiscogs maps the two 503s differently", async () => {
    const { fetchDiscogs } = await import("@/components/finder/use-discogs");
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "unavailable", retryAfter: 2 }, 503)));
    expect((await fetchDiscogs("/api/discogs/search?q=x&mode=artist")).kind).toBe("error");
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "unconfigured" }, 503)));
    expect((await fetchDiscogs("/api/discogs/search?q=x&mode=artist")).kind).toBe("unconfigured");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    expect((await fetchDiscogs("/api/discogs/search?q=x&mode=artist")).kind).toBe("error"); // an empty body is not "unconfigured" either
  });
});

describe("every caller of hit() has chosen a failure policy", () => {
  const ROOT = join(__dirname, "..", "..", "src");
  const files = (dir: string, out: string[] = []): string[] => {
    for (const n of readdirSync(dir)) {
      const full = join(dir, n);
      if (statSync(full).isDirectory()) files(full, out);
      else if (/\.(ts|tsx)$/.test(n)) out.push(full);
    }
    return out;
  };

  it("hit() is called only from the reviewed places, and each handles LimiterUnavailableError (or fails open on purpose)", () => {
    const callers = files(ROOT)
      .filter((f) => /\bhit\(/.test(readFileSync(f, "utf8")) && !f.endsWith(join("server", "rate-limit.ts")))
      .map((f) => relative(ROOT, f).replaceAll("\\", "/"))
      .sort();
    expect(callers).toEqual(["app/api/csp-report/route.ts", "server/discogs/cold-limit.ts", "server/discogs/http.ts", "server/lists/gate.ts"]);
    for (const c of callers) {
      const text = readFileSync(join(ROOT, c), "utf8");
      const decided = text.includes("LimiterUnavailableError") || (c === "app/api/csp-report/route.ts" && text.includes("fails OPEN"));
      expect(decided, `${c} must say how it fails when the counter is down`).toBe(true);
    }
  });
});
