import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { judgeCookies, judgeHeaders, MAX_AUTH_PROBES, MAX_REQUESTS, parseBase, runSmoke, SmokeTargetError } from "../../scripts/lib/smoke-prod";

/**
 * The production smoke script is tested against a FAKE site on 127.0.0.1 (never the real one): a well-behaved one passes, and each kind of
 * defect (a missing header, a session cookie for an anonymous visitor, a limiter that never answers 429, a wrong status) is reported.
 */

const NONCE = "abcDEF123456789==";
const GOOD_CSP = `default-src 'self'; script-src 'self' 'nonce-${NONCE}'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'; report-uri /api/csp-report`;

interface Fake {
  headers?: Record<string, string>;
  cookies?: string[];
  limiter?: boolean; // answers 429 on the 9th sign-in
  health?: unknown;
  statuses?: Record<string, number>; // path -> status override
  placeholderOn?: string; // a path whose page shows an unfilled placeholder
}

let server: http.Server | null = null;
const posts: string[] = [];
afterEach(() => {
  server?.close();
  server = null;
  posts.length = 0;
});

async function start(fake: Fake = {}): Promise<string> {
  const signIns = { n: 0 };
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname;
    const send = (status: number, body: string, type = "text/html; charset=utf-8", extra: Record<string, string | string[]> = {}) => {
      res.writeHead(status, { "content-type": type, ...extra });
      res.end(body);
    };
    const secHeaders: Record<string, string | string[]> = {
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "cross-origin-opener-policy": "same-origin-allow-popups",
      "content-security-policy-report-only": GOOD_CSP,
      ...(fake.cookies ? { "set-cookie": fake.cookies } : {}),
      ...fake.headers,
    };
    const override = fake.statuses?.[path];
    if (override !== undefined) return send(override, "x", "text/plain");
    if (req.method === "POST") {
      posts.push(path);
      signIns.n++;
      return send(fake.limiter === false ? 401 : signIns.n > 8 ? 429 : 401, "{}", "application/json");
    }
    if (path === "/") return send(307, "", "text/plain", { location: "/en" });
    const m = /^\/(uk|en|nb)(\/privacy|\/terms|\/contact)?$/.exec(path);
    if (m) return send(200, `<html lang="${m[1]}"><head><title>Vinilium</title></head><body>${path === fake.placeholderOn ? "[CONTACT EMAIL – TO BE FILLED]" : "ok"}</body></html>`, "text/html; charset=utf-8", secHeaders);
    if (path === "/robots.txt") return send(200, "User-Agent: *\nAllow: /\nDisallow: /api/\nSitemap: http://x/sitemap.xml\n", "text/plain");
    if (path === "/sitemap.xml") return send(200, `<urlset><url><loc>http://x/en/privacy</loc></url></urlset>`, "application/xml");
    if (path === "/manifest.webmanifest") return send(200, JSON.stringify({ name: "Vinilium", icons: [{ src: "/i.png" }] }), "application/manifest+json");
    if (path === "/api/health") return send(200, JSON.stringify(fake.health ?? { status: "ok", version: "0.1.0", db: "up" }), "application/json", { "cache-control": "no-store" });
    if (path.startsWith("/api/") && /discogs|lists|account|cron/.test(path)) return send(401, JSON.stringify({ error: "unauthorized" }), "application/json");
    return send(404, "not found", "text/plain");
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

describe("parseBase", () => {
  it("accepts the production site and localhost, refuses anything else unless allowed", () => {
    expect(parseBase("https://vinilium.vercel.app/")).toBe("https://vinilium.vercel.app");
    expect(parseBase("http://localhost:3000")).toBe("http://localhost:3000");
    expect(() => parseBase("https://example.org")).toThrow(SmokeTargetError);
    expect(parseBase("https://example.org", true)).toBe("https://example.org");
    expect(() => parseBase("ftp://vinilium.vercel.app")).toThrow(SmokeTargetError);
    expect(() => parseBase("https://user:pw@vinilium.vercel.app")).toThrow(SmokeTargetError);
    expect(() => parseBase("not a url")).toThrow(SmokeTargetError);
  });
});

describe("judgeHeaders / judgeCookies (pure)", () => {
  const good = () => new Headers({ "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "strict-origin-when-cross-origin", "permissions-policy": "camera=(), microphone=()", "cross-origin-opener-policy": "same-origin", "content-security-policy": GOOD_CSP });
  it("passes a complete set and reports the CSP mode", () => {
    const r = judgeHeaders(good(), { https: true, expectCsp: "enforce" });
    expect(r.filter((c) => c.level === "fail")).toEqual([]);
  });
  it("fails a missing header, a CSP with unsafe-inline scripts, and the wrong mode", () => {
    const h = good();
    h.delete("x-frame-options");
    expect(judgeHeaders(h, { https: true }).some((c) => c.level === "fail" && c.name.includes("X-Frame-Options"))).toBe(true);
    const weak = good();
    weak.set("content-security-policy", GOOD_CSP.replace(`'nonce-${NONCE}'`, "'unsafe-inline'"));
    expect(judgeHeaders(weak, { https: true }).some((c) => c.level === "fail" && c.name.startsWith("CSP script-src"))).toBe(true);
    expect(judgeHeaders(good(), { https: true, expectCsp: "report-only" }).some((c) => c.level === "fail")).toBe(true);
  });
  it("HSTS is required only when asked for, and only over https", () => {
    expect(judgeHeaders(good(), { https: true, expectHsts: true }).some((c) => c.level === "fail" && c.name === "HSTS present")).toBe(true);
    const h = good();
    h.set("strict-transport-security", "max-age=31536000");
    expect(judgeHeaders(h, { https: true, expectHsts: true }).some((c) => c.level === "fail")).toBe(false);
    expect(judgeHeaders(good(), { https: false, expectHsts: true }).some((c) => c.level === "fail")).toBe(false);
  });
  it("a session cookie for an anonymous visitor fails; a language cookie with SameSite and Secure passes", () => {
    expect(judgeCookies([], true)[0].level).toBe("pass");
    expect(judgeCookies(["better-auth.session_token=abc; Path=/; HttpOnly"], true)[0].level).toBe("fail");
    expect(judgeCookies(["NEXT_LOCALE=en; Path=/; SameSite=lax; Secure"], true)[0].level).toBe("pass");
    expect(judgeCookies(["NEXT_LOCALE=en; Path=/; SameSite=lax"], true)[0].level).toBe("warn");
  });
});

describe("runSmoke against a fake site", () => {
  it("a well-behaved site passes, with few requests and at most 10 POSTs", async () => {
    const base = await start({ cookies: ["NEXT_LOCALE=en; Path=/; SameSite=lax"] });
    const report = await runSmoke({ base, expectCsp: "report-only" });
    expect(report.checks.filter((c) => c.level === "fail")).toEqual([]);
    expect(report.requests).toBeLessThanOrEqual(MAX_REQUESTS);
    expect(posts.length).toBeLessThanOrEqual(MAX_AUTH_PROBES);
    expect(posts.length).toBe(9); // stops at the first 429, the 9th request
    expect(new Set(posts)).toEqual(new Set(["/api/auth/sign-in/email"])); // only the sign-in endpoint is ever POSTed to
  });

  it("--no-rate-limit-check sends no POST at all", async () => {
    const base = await start();
    const report = await runSmoke({ base, rateLimitCheck: false });
    expect(posts).toEqual([]);
    expect(report.failed).toBe(0);
  });

  it("reports a limiter that never answers 429, and stops after 10 POSTs", async () => {
    const base = await start({ limiter: false });
    const report = await runSmoke({ base });
    expect(report.checks.find((c) => c.name === "sign-in limiter answers 429")?.level).toBe("fail");
    expect(posts.length).toBe(MAX_AUTH_PROBES);
  });

  it("reports an anonymous session cookie, a missing header, an API that answers 200, and a broken health route", async () => {
    const base = await start({
      cookies: ["better-auth.session_token=abc; Path=/; HttpOnly; Secure"],
      headers: { "x-frame-options": "" },
      statuses: { "/api/lists/items": 200 },
      health: { status: "ok", db: "up", secret: "leak" },
    });
    const report = await runSmoke({ base, rateLimitCheck: false });
    const failed = report.checks.filter((c) => c.level === "fail").map((c) => c.name);
    expect(failed).toContain("cookie better-auth.session_token");
    expect(failed).toContain("header X-Frame-Options");
    expect(failed).toContain("401 /api/lists/items");
    expect(failed).toContain("/api/health");
  });

  it("an unfilled placeholder on a legal page fails that page (a NEXT_PUBLIC_* variable is unset)", async () => {
    const base = await start({ placeholderOn: "/en/privacy" });
    const report = await runSmoke({ base, rateLimitCheck: false });
    expect(report.checks.filter((c) => c.level === "fail").map((c) => c.name)).toEqual(["page /en/privacy"]);
  });

  it("a site that is down fails every check without throwing", async () => {
    const report = await runSmoke({ base: "http://127.0.0.1:1", rateLimitCheck: false });
    expect(report.failed).toBeGreaterThan(10);
  });
});
