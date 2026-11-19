import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { discogsBucket, discogsCache, rateLimit, userItems, user } from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";
import { MAX_ALBUM_VIEWS, MAX_SEARCH_PAGES, MAX_VERSION_PAGES, finderQuery, fromRecord, masterQuery, parseFinder, parseMaster, withQuery } from "@/lib/finder-state";
import { safeNextPath } from "@/server/auth/session";
import { createTestDb } from "../helpers/pglite";
import { setEnv } from "../helpers/env";

/**
 * Input fuzzing with a seeded generator (the same corpus every run): the finder's URL state, every API parameter, and the redirect
 * target. The properties are the point: nothing throws, nothing answers 500, nothing leaks a stack trace, state stays inside its bounds,
 * and nothing that did not come from our own code ever reaches Discogs.
 */

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = rng(20261118);
const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)];

const NASTY = [
  "", " ", "0", "-1", "1e3", "NaN", "Infinity", "null", "undefined", "true", "[]", "{}", "[object Object]", "%", "%00", "%0a", "%2e%2e%2f", "../../etc/passwd", "..\\..\\windows", "/", "//evil.example", "https://evil.example",
  "javascript:alert(1)", "' OR 1=1 --", "\"; DROP TABLE user; --", "<script>alert(1)</script>", "${7*7}", "{{7*7}}", "\u0000", "‮", "\ud83d", "😀".repeat(80), "ÆØÅ æøå", "Ukraїna", "a".repeat(5000), "9".repeat(40),
  "1,2,3", "1,,2", "1;2", "0x10", "００１", "\n", "\r\n", "\t", "a=b&c=d", "ǅ", "İ",
];
const junk = () => {
  const parts = Array.from({ length: 1 + Math.floor(random() * 4) }, () => pick(NASTY));
  // Well-formed UTF-16: an address bar can never carry a lone surrogate (it is percent-encoded or replaced before we see it).
  return parts.join(random() < 0.3 ? pick(["", " ", "/", "?", "&", "%"]) : "").toWellFormed();
};
const noControl = /^[^\u0000-\u001f\u007f]*$/;

describe("fuzz: the finder's URL state", () => {
  it("parseFinder and parseMaster never throw, and every value stays inside its bounds", () => {
    const names = ["mode", "q", "by", "g", "n", "sp", "o", "a", "t", "country", "released", "label", "vp"];
    for (let i = 0; i < 3000; i++) {
      const params = new URLSearchParams();
      for (const n of names) if (random() < 0.7) params.set(n, junk());
      const f = parseFinder(params);
      const m = parseMaster(params);
      expect(["track", "artist", "album"]).toContain(f.mode);
      expect(f.q.length).toBeLessThanOrEqual(100);
      expect(f.by.length).toBeLessThanOrEqual(100);
      if (f.mode === "artist") expect(f.by).toBe("");
      expect(f.views).toBeGreaterThanOrEqual(1);
      expect(f.views).toBeLessThanOrEqual(MAX_ALBUM_VIEWS);
      expect(f.searchPages).toBeGreaterThanOrEqual(1);
      expect(f.searchPages).toBeLessThanOrEqual(MAX_SEARCH_PAGES);
      expect(m.versionPages).toBeGreaterThanOrEqual(1);
      expect(m.versionPages).toBeLessThanOrEqual(MAX_VERSION_PAGES);
      for (const v of [f.q, f.by, f.g ?? "", m.a ?? "", m.t ?? "", m.country ?? "", m.released ?? "", m.label ?? ""]) expect(noControl.test(v)).toBe(true);
      // what we write back is as safe as what we read, and reading it again changes nothing (a stable round trip)
      const back = parseFinder(new URLSearchParams(finderQuery(f)));
      if (f.q) expect(back).toEqual({ ...f, by: f.mode === "artist" ? "" : f.by, g: f.g, views: f.g ? f.views : back.views, othersOpen: f.g ? f.othersOpen : back.othersOpen });
      const mq = masterQuery(m);
      expect(parseMaster(new URLSearchParams(mq))).toEqual({ ...m, a: m.a, t: m.t });
    }
  });

  it("fromRecord only reads the first value of a repeated parameter and tolerates missing ones", () => {
    expect(parseFinder(fromRecord({ q: ["first", "second"], mode: ["album"] })).q).toBe("first");
    expect(parseFinder(fromRecord({})).mode).toBe("track");
  });

  it("withQuery builds an address that stays on the same site, whatever the values are", () => {
    for (let i = 0; i < 500; i++) {
      // The values are what the finder holds after parsing the address (clamped), which is what every Back link and sign-in target is built from.
      const state = parseFinder(new URLSearchParams({ q: junk(), by: junk(), g: junk(), mode: "track" }));
      const href = withQuery("/search", { q: state.q, by: state.by, g: state.g ?? "" });
      expect(href.startsWith("/search")).toBe(true);
      expect(safeNextPath(href), href).toBe(href); // our own sign-in "next" targets always pass the redirect guard
    }
  });
});

describe("fuzz: the redirect target", () => {
  it("safeNextPath never returns anything a browser could read as another site", () => {
    const alphabet = ["/", "\\", "\t", "\n", "\r", " ", "%2f", "%5c", "%09", "@", ":", ".", "?", "#", "a", "evil.example", "http", "https", "javascript", "data", "\u0000", " ", "é", "..", "//", "/\\", "\\/"];
    let accepted = 0;
    for (let i = 0; i < 40_000; i++) {
      const v = Array.from({ length: 1 + Math.floor(random() * 9) }, () => pick(alphabet)).join("");
      const out = safeNextPath(random() < 0.1 ? [v, "/x"] : v);
      if (out === null) continue;
      accepted++;
      expect(out.startsWith("/") && !out.startsWith("//"), JSON.stringify(out)).toBe(true);
      expect(/[\\\u0000-\u001f\u007f]/.test(out), JSON.stringify(out)).toBe(false);
      expect(new URL(out, "http://app.invalid").origin, JSON.stringify(out)).toBe("http://app.invalid");
    }
    expect(accepted).toBeGreaterThan(100); // the fuzzer does produce valid paths, so the property above is not vacuous
  });

  it.each([
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r/evil.example",
    "/\u0000/evil.example",
    "/\\evil.example",
    "\\/evil.example",
    "//evil.example",
    "///evil.example",
    "/%2f/evil.example", // stays a path on this site: %2f is not a slash to the URL parser
    "http://evil.example",
    "https:/evil.example",
    "javascript:alert(1)",
    "data:text/html,x",
    " /search",
    "",
  ])("%j is handled", (value) => {
    const out = safeNextPath(value);
    if (out !== null) expect(new URL(out, "http://app.invalid").origin).toBe("http://app.invalid");
    if (/^\/[\t\n\r\u0000\\]|^\/\/|^[^/]/.test(value)) expect(out).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// The API routes

let db: AppDb;
let close: () => Promise<void>;
const getSession = vi.fn();
vi.mock("@/server/db", async () => ({ getDb: () => db, schema: await import("@/server/db/schema") }));
vi.mock("@/server/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));

const BASE = "http://discogs.test";
let upstream: ReturnType<typeof vi.fn>;
const upstreamUrls: string[] = [];

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(user).values({ id: "fuzz-user", name: "Fuzz", email: "fuzz@example.test" });
});
afterAll(() => close());
beforeEach(async () => {
  vi.resetModules();
  setEnv({ DISCOGS_API_BASE: BASE, RL_SEARCH_IP_PER_MIN: "100000", RL_SEARCH_USER_PER_MIN: "100000", RL_COLD_USER_PER_MIN: "100000", RL_IMAGE_IP_PER_MIN: "100000", RL_IMAGE_USER_PER_MIN: "100000" });
  await db.delete(rateLimit);
  await db.delete(discogsCache);
  await db.delete(discogsBucket);
  await db.delete(userItems);
  getSession.mockReset();
  getSession.mockResolvedValue({ user: { id: "fuzz-user" } });
  upstreamUrls.length = 0;
  upstream = vi.fn(async (u: URL | string) => {
    const url = new URL(String(u));
    upstreamUrls.push(url.origin + url.pathname);
    if (url.pathname.startsWith("/masters/") && url.pathname.endsWith("/versions")) return new Response(JSON.stringify({ pagination: { page: 1, pages: 1, per_page: 50, items: 0 }, versions: [] }), { headers: { "content-type": "application/json" } });
    if (url.pathname.startsWith("/masters/")) return new Response(JSON.stringify({ id: 1, title: "Synthetic" }), { headers: { "content-type": "application/json" } });
    if (url.pathname.startsWith("/releases/")) return new Response(JSON.stringify({ id: 1, title: "Synthetic", formats: [{ name: "Vinyl", qty: 1 }] }), { headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ pagination: { page: 1, pages: 1, per_page: 50, items: 0 }, results: [] }), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", upstream);
});

const headers = { cookie: "better-auth.session_token=abc", "x-forwarded-for": "198.51.100.77" };
const OK_STATUSES = new Set([200, 400, 404, 409, 429, 502, 503]);
const noLeak = (text: string) => expect(text).not.toMatch(/\bat\s+\S+\s+\(|node_modules|\.tsx?:\d+|stack|ECONN|postgres(ql)?:\/\/|select\s.+from\s|syntax error/i);

async function expectSafe(res: Response, label: string) {
  expect(OK_STATUSES.has(res.status), `${label}: status ${res.status}`).toBe(true);
  const text = await res.text();
  expect(() => JSON.parse(text), `${label}: JSON body`).not.toThrow();
  noLeak(text);
  expect(res.headers.get("cache-control"), label).toMatch(/no-store/);
}

describe("fuzz: the Discogs routes", () => {
  it("search, masters, versions, releases and the single release: never a 500, never a leak, never an odd upstream address", { timeout: 120_000 }, async () => {
    const search = (await import("@/app/api/discogs/search/route")).GET;
    const masters = (await import("@/app/api/discogs/masters/route")).GET;
    const versions = (await import("@/app/api/discogs/masters/[id]/versions/route")).GET;
    const releases = (await import("@/app/api/discogs/releases/route")).GET;
    const release = (await import("@/app/api/discogs/releases/[id]/route")).GET;
    const req = (path: string) => new Request(`http://localhost${path}`, { headers });
    const enc = (s: string) => encodeURIComponent(s.toWellFormed());

    for (let i = 0; i < 120; i++) {
      const q = junk();
      let label = `search q=${q.slice(0, 30)}`;
      const url = `/api/discogs/search?q=${enc(q)}&mode=${enc(pick(["track", "artist", "album", junk()]))}&by=${enc(junk())}&page=${enc(pick(["1", "2", "6", "0", "-1", "1.5", junk()]))}`;
      try {
        await expectSafe(await search(req(url)), label);
      } catch (e) {
        throw new Error(`${label}: ${JSON.stringify(url).slice(0, 400)} -> ${String(e)}`);
      }

      label = "masters";
      await expectSafe(await masters(req(`/api/discogs/masters?ids=${enc(pick(["1,2,3", "1", "0", "1,1,1", junk(), Array.from({ length: 20 }, (_, k) => k + 1).join(",")]))}`)), label);

      label = "releases";
      await expectSafe(await releases(req(`/api/discogs/releases?ids=${enc(pick(["5", "5,6", "-5", "007", junk(), Array.from({ length: 30 }, (_, k) => k + 1).join(",")]))}`)), label);

      const id = pick(["12345", "0", "-1", "1e3", "0x1", junk(), "99999999999", "٣"]);
      label = `versions ${id.slice(0, 20)}`;
      await expectSafe(await versions(req(`/api/discogs/masters/${enc(id)}/versions?page=${enc(pick(["1", "11", "abc", junk()]))}&country=${enc(junk())}&label=${enc(junk())}&released=${enc(pick(["2001", "20x1", junk()]))}`), { params: Promise.resolve({ id }) }), label);

      label = `release ${id.slice(0, 20)}`;
      await expectSafe(await release(req(`/api/discogs/releases/${enc(id)}`), { params: Promise.resolve({ id }) }), label);
    }

    // Whatever was asked, the only addresses that ever went out are the exact Discogs paths we build ourselves.
    expect(upstreamUrls.length).toBeGreaterThan(20);
    for (const u of upstreamUrls) {
      // exact origin (scheme, host and port), not a string prefix: "http://discogs.test.evil.example/x" also starts with BASE
      expect(new URL(u).origin, u).toBe(new URL(BASE).origin);
      expect(new URL(u).pathname, u).toMatch(/^\/(database\/search|masters\/[1-9]\d{0,9}(\/versions)?|releases\/[1-9]\d{0,9})$/);
    }
  });

  it("the image proxy refuses junk addresses without any upstream call", async () => {
    const image = (await import("@/app/api/discogs/image/route")).GET;
    for (let i = 0; i < 300; i++) {
      const res = await image(new Request(`http://localhost/api/discogs/image?u=${encodeURIComponent(junk().toWellFormed())}`, { headers }));
      expect([400, 429].includes(res.status), `status ${res.status}`).toBe(true);
      noLeak(await res.text());
    }
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("fuzz: the lists routes", () => {
  it("GET /api/lists/items and PUT/PATCH /api/lists/items/:id answer with a clean 4xx or 2xx for any input", async () => {
    const list = await import("@/app/api/lists/items/route");
    const item = await import("@/app/api/lists/items/[releaseId]/route");
    const base = { ...headers, origin: "http://localhost", host: "localhost" };
    const enc = (s: string) => encodeURIComponent(s.toWellFormed());
    for (let i = 0; i < 300; i++) {
      const get = await list.GET(new Request(`http://localhost/api/lists/items?list=${enc(pick(["wishlist", "collection", junk()]))}&q=${enc(junk())}&sort=${enc(pick(["added", "notes", "condition", junk()]))}&dir=${enc(pick(["asc", "desc", junk()]))}&page=${enc(pick(["1", "99999999999", "0", junk()]))}&pageSize=${enc(pick(["12", "24", "13", junk()]))}`, { headers: base }));
      await expectSafe(get, "lists GET");

      const releaseId = pick(["777", "0", junk()]);
      const ctx = { params: Promise.resolve({ releaseId }) };
      const body = pick([
        JSON.stringify({ list: pick(["wishlist", "collection", junk()]) }),
        JSON.stringify({ notes: junk(), conditionMedia: pick(["NM", "VG+", junk(), null]), conditionSleeve: pick(["M", junk(), null]) }),
        junk(),
        "null",
        "[]",
        JSON.stringify({ list: ["wishlist"] }),
        JSON.stringify({ __proto__: { admin: true }, notes: "x" }),
      ]);
      for (const method of ["PUT", "PATCH"] as const) {
        const fn = item[method];
        await expectSafe(await fn(new Request(`http://localhost/api/lists/items/${enc(releaseId)}`, { method, headers: { ...base, "content-type": "application/json" }, body }), ctx), `lists ${method}`);
      }
    }
    // writes only ever touched the fuzz user's own rows, and the table still satisfies its own constraints
    const rows = await db.select().from(userItems);
    for (const r of rows) {
      expect(r.userId).toBe("fuzz-user");
      expect(["wishlist", "collection"]).toContain(r.list);
    }
  });
});
