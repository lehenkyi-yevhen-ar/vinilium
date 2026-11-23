/**
 * The production smoke test: anonymous, read-only HTTP checks of a deployed site. Used by scripts/smoke-prod.ts (the owner runs it; the
 * agent never does) and unit-tested against a fake server (tests/unit/smoke-prod.test.ts).
 *
 * What it does NOT do: it never signs in, never creates an account, never sends an email, never writes anything on purpose, never reads a
 * secret or an environment file. It makes plain GET requests (about 30) plus AT MOST `MAX_AUTH_PROBES` (10) POSTs to the sign-in endpoint with
 * an address that cannot exist (`smoke-test@example.invalid`, RFC 2606), to see the per-IP limit answer 429. Those POSTs leave exactly one thing
 * behind: the limiter's own counter row for this IP and endpoint (it expires within a minute and the daily purge removes it); they cannot sign
 * anybody in, send a message or create a user. A hard cap (`MAX_REQUESTS`) stops the run if anything ever tried to make more.
 */

export const MAX_AUTH_PROBES = 10; // the limit on /sign-in/email is 8 a minute: the 9th request must be refused
export const MAX_REQUESTS = 60;
export const LOCALES = ["uk", "en", "nb"] as const;
export const DEFAULT_BASE = "https://vinilium.vercel.app";
const SMOKE_UA = "vinilium-smoke/1 (anonymous read-only check run by the owner)";

export type Level = "pass" | "fail" | "warn" | "info";
export interface Check {
  name: string;
  level: Level;
  detail: string;
}

export interface SmokeOptions {
  base: string;
  /** Require this CSP mode (default: just report which one is on). */
  expectCsp?: "report-only" | "enforce";
  /** Require a Strict-Transport-Security header (only meaningful over https). */
  expectHsts?: boolean;
  /** false = skip the (at most 10) POSTs that look for the 429 of the sign-in limiter. */
  rateLimitCheck?: boolean;
  fetchImpl?: typeof fetch;
}

export interface SmokeReport {
  checks: Check[];
  requests: number;
  failed: number;
  warned: number;
}

export class SmokeTargetError extends Error {}

/** Only an exact origin may be tested; another host needs the explicit `allowOtherHost` flag of the CLI. */
export function parseBase(raw: string, allowOtherHost = false): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SmokeTargetError(`not a URL: ${raw}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new SmokeTargetError("only http(s) addresses can be tested");
  if (u.username || u.password) throw new SmokeTargetError("the address must not contain credentials");
  const host = u.hostname;
  const known = host === "vinilium.vercel.app" || host === "localhost" || host === "127.0.0.1";
  if (!known && !allowOtherHost) throw new SmokeTargetError(`${host} is not the production site or localhost; pass --allow-other-host if you really mean it`);
  return u.origin;
}

const cookieName = (raw: string) => raw.split("=")[0]?.trim() ?? "";
const cookieFlags = (raw: string) => raw.split(";").slice(1).map((p) => p.trim().toLowerCase());

/** Pure: judges the security headers of one page response. Exported for the unit test. */
export function judgeHeaders(h: Headers, opts: { https: boolean; expectCsp?: "report-only" | "enforce"; expectHsts?: boolean }): Check[] {
  const out: Check[] = [];
  const add = (name: string, ok: boolean, detail: string, level: Level = ok ? "pass" : "fail") => out.push({ name, level, detail });
  add("header X-Content-Type-Options", h.get("x-content-type-options")?.toLowerCase() === "nosniff", h.get("x-content-type-options") ?? "missing");
  add("header X-Frame-Options", (h.get("x-frame-options") ?? "").toUpperCase() === "DENY", h.get("x-frame-options") ?? "missing");
  add("header Referrer-Policy", /^(strict-origin-when-cross-origin|strict-origin|same-origin|no-referrer)$/i.test(h.get("referrer-policy") ?? ""), h.get("referrer-policy") ?? "missing");
  add("header Permissions-Policy", /camera=\(\)/.test(h.get("permissions-policy") ?? "") && /microphone=\(\)/.test(h.get("permissions-policy") ?? ""), h.get("permissions-policy") ? "present, camera and microphone off" : "missing");
  add("header Cross-Origin-Opener-Policy", Boolean(h.get("cross-origin-opener-policy")), h.get("cross-origin-opener-policy") ?? "missing");

  const enforced = h.get("content-security-policy");
  const reportOnly = h.get("content-security-policy-report-only");
  const csp = enforced ?? reportOnly;
  const mode = enforced ? "enforce" : reportOnly ? "report-only" : "none";
  add("CSP present", Boolean(csp), `mode: ${mode}`);
  if (csp) {
    const scriptSrc = /(?:^|;)\s*script-src ([^;]*)/.exec(csp)?.[1] ?? "";
    add("CSP script-src: own origin and a nonce, no unsafe-inline / unsafe-eval", /'self'/.test(scriptSrc) && /'nonce-[A-Za-z0-9+/=_-]+'/.test(scriptSrc) && !/unsafe-inline|unsafe-eval/.test(scriptSrc), scriptSrc.replace(/'nonce-[^']+'/, "'nonce-<redacted>'") || "missing");
    add("CSP frame-ancestors 'none'", /frame-ancestors 'none'/.test(csp), /frame-ancestors [^;]*/.exec(csp)?.[0] ?? "missing");
    add("CSP object-src 'none' and a report-uri", /object-src 'none'/.test(csp) && /report-uri \/api\/csp-report/.test(csp), "object-src / report-uri");
  }
  if (opts.expectCsp) add(`CSP mode is ${opts.expectCsp}`, mode === opts.expectCsp, `found ${mode}`);
  else out.push({ name: "CSP mode", level: "info", detail: `${mode} (pass --expect-csp enforce|report-only to require one)` });

  const hsts = h.get("strict-transport-security");
  if (!opts.https) out.push({ name: "HSTS", level: "info", detail: "not checked on http" });
  else if (opts.expectHsts) add("HSTS present", Boolean(hsts) && /max-age=\d{6,}/.test(hsts ?? ""), hsts ?? "missing");
  else out.push({ name: "HSTS", level: "info", detail: hsts ? hsts : "not sent (it is opt-in: HSTS_MAX_AGE_SECONDS; see docs/LAUNCH.md)" });
  return out;
}

/** Pure: judges the cookies an ANONYMOUS visitor received. A session or token cookie here would be a defect. */
export function judgeCookies(setCookies: string[], https: boolean): Check[] {
  if (setCookies.length === 0) return [{ name: "cookies for an anonymous visitor", level: "pass", detail: "none set" }];
  const out: Check[] = [];
  const seen = new Set<string>();
  for (const raw of setCookies) {
    const name = cookieName(raw);
    if (seen.has(name)) continue;
    seen.add(name);
    const flags = cookieFlags(raw);
    const sensitive = /session|token|auth/i.test(name);
    if (sensitive) {
      out.push({ name: `cookie ${name}`, level: "fail", detail: "a session/token cookie was handed to an anonymous visitor" });
      continue;
    }
    const sameSite = flags.find((f) => f.startsWith("samesite="));
    const secure = flags.includes("secure");
    const ok = Boolean(sameSite) && (!https || secure);
    out.push({
      name: `cookie ${name}`,
      level: ok ? "pass" : "warn",
      detail: `flags: ${flags.join("; ") || "none"}${!sameSite ? " (no SameSite)" : ""}${https && !secure ? " (no Secure on https)" : ""}`,
    });
  }
  return out;
}

export async function runSmoke(options: SmokeOptions): Promise<SmokeReport> {
  const base = options.base.replace(/\/+$/, "");
  const https = base.startsWith("https:");
  const doFetch = options.fetchImpl ?? fetch;
  const checks: Check[] = [];
  const cookies: string[] = [];
  let requests = 0;

  const request = async (path: string, init: RequestInit = {}) => {
    if (++requests > MAX_REQUESTS) throw new Error(`more than ${MAX_REQUESTS} requests: stopped (this script is meant to stay small)`);
    const res = await doFetch(`${base}${path}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      ...init,
      headers: { "user-agent": SMOKE_UA, ...(init.headers as Record<string, string> | undefined) },
    });
    for (const c of res.headers.getSetCookie?.() ?? []) cookies.push(c);
    return res;
  };
  const add = (name: string, ok: boolean, detail: string, level: Level = ok ? "pass" : "fail") => checks.push({ name, level, detail });
  const guard = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      add(name, false, `request failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  };

  // 1. The root sends a visitor to a language.
  await guard("/ goes to a language", async () => {
    const res = await request("/");
    const loc = res.headers.get("location") ?? "";
    add("/ goes to a language", (res.status >= 300 && res.status < 400 && /^(https?:\/\/[^/]+)?\/(uk|en|nb)\/?$/.test(loc)) || res.status === 200, `${res.status}${loc ? ` -> ${loc}` : ""}`);
  });

  // 2. Public pages in every language.
  const home: { headers: Headers | null } = { headers: null };
  for (const l of LOCALES) {
    for (const page of ["", "/privacy", "/terms", "/contact"]) {
      const path = `/${l}${page}`;
      await guard(`page ${path}`, async () => {
        const res = await request(path);
        const body = res.status === 200 ? await res.text() : "";
        if (path === "/en") home.headers = res.headers;
        const placeholder = /TO BE FILLED/.test(body); // an unset NEXT_PUBLIC_OPERATOR_* / _CONTACT_EMAIL shows "[... – TO BE FILLED]" on the legal and contact pages
        const ok = res.status === 200 && /text\/html/.test(res.headers.get("content-type") ?? "") && new RegExp(`<html[^>]*lang="${l}"`).test(body) && /<title>[^<]+<\/title>/.test(body) && !placeholder;
        add(`page ${path}`, ok, `${res.status}, ${res.headers.get("content-type") ?? "no content-type"}${placeholder ? ", a placeholder marked TO BE FILLED is showing (a NEXT_PUBLIC_* variable is unset)" : ok ? "" : ", expected html with lang and title"}`);
        if (ok && /\[NEEDS LEGAL REVIEW\]/.test(body)) checks.push({ name: `legal mark on ${path}`, level: "info", detail: "a [NEEDS LEGAL REVIEW] mark is still visible (npm run legal:checklist)" });
      });
    }
  }

  // 3. Unknown pages are a 404, not a crash or a redirect to a login.
  await guard("404 for an unknown page", async () => {
    const res = await request(`/en/this-page-does-not-exist-smoke`);
    add("404 for an unknown page", res.status === 404, String(res.status));
  });
  await guard("404 for an unknown API route", async () => {
    const res = await request(`/api/this-route-does-not-exist-smoke`);
    add("404 for an unknown API route", res.status === 404, String(res.status));
  });

  // 4. robots.txt, sitemap.xml, manifest.
  await guard("robots.txt", async () => {
    const res = await request("/robots.txt");
    const body = res.status === 200 ? await res.text() : "";
    add("robots.txt", res.status === 200 && /^Sitemap: .+\/sitemap\.xml/im.test(body) && /^Disallow: \/api\//im.test(body), `${res.status}; sitemap line and Disallow: /api/`);
  });
  await guard("sitemap.xml", async () => {
    const res = await request("/sitemap.xml");
    const body = res.status === 200 ? await res.text() : "";
    add("sitemap.xml", res.status === 200 && /<urlset/.test(body) && /\/en\/privacy/.test(body) && !/\/api\/|\/search|\/account/.test(body), `${res.status}; public pages only, no app or API paths`);
  });
  await guard("manifest", async () => {
    const res = await request("/manifest.webmanifest");
    const j = res.status === 200 ? ((await res.json().catch(() => null)) as { name?: string; icons?: unknown[] } | null) : null;
    add("manifest", Boolean(j?.name) && Array.isArray(j?.icons) && (j?.icons?.length ?? 0) > 0, `${res.status}${j?.name ? `, name ${j.name}` : ""}`);
  });

  // 5. Health.
  await guard("/api/health", async () => {
    const res = await request("/api/health");
    const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const keys = j ? Object.keys(j).sort().join(",") : "";
    add("/api/health", res.status === 200 && j?.status === "ok" && j?.db === "up" && keys === "db,status,version" && /no-store/.test(res.headers.get("cache-control") ?? ""), `${res.status} ${j ? JSON.stringify({ status: j.status, db: j.db }) : "no JSON"}; keys: ${keys}; no-store`);
  });

  // 6. Anonymous callers get 401 from the API (nothing reaches Discogs).
  for (const path of ["/api/discogs/search?q=smoke&mode=artist", "/api/discogs/masters/500/versions", "/api/discogs/releases/123", "/api/lists/items", "/api/account/export"]) {
    await guard(`401 ${path.split("?")[0]}`, async () => {
      const res = await request(path);
      const text = await res.text();
      add(`401 ${path.split("?")[0]}`, res.status === 401 && !/<html/i.test(text), `${res.status}`);
    });
  }
  await guard("cron purge refuses without its secret", async () => {
    const res = await request("/api/cron/purge");
    add("cron purge refuses without its secret", res.status === 401, String(res.status));
  });

  // 7. Security headers and CSP mode, on the English home page.
  if (home.headers) checks.push(...judgeHeaders(home.headers, { https, expectCsp: options.expectCsp, expectHsts: options.expectHsts }));
  else add("security headers", false, "the English home page did not answer, so there are no headers to judge");

  // 8. The limiter on the sign-in endpoint (at most MAX_AUTH_PROBES POSTs, an address that cannot exist).
  if (options.rateLimitCheck === false) {
    checks.push({ name: "sign-in limiter answers 429", level: "info", detail: "skipped (--no-rate-limit-check)" });
  } else {
    await guard("sign-in limiter answers 429", async () => {
      const statuses: number[] = [];
      for (let i = 0; i < MAX_AUTH_PROBES; i++) {
        const res = await request("/api/auth/sign-in/email", {
          method: "POST",
          headers: { "content-type": "application/json", origin: base },
          body: JSON.stringify({ email: "smoke-test@example.invalid", password: "not-a-real-password" }),
        });
        statuses.push(res.status);
        await res.arrayBuffer().catch(() => undefined);
        if (res.status === 429) break;
      }
      const got429 = statuses.includes(429);
      const anySuccess = statuses.some((s) => s >= 200 && s < 300);
      add("sign-in limiter answers 429", got429 && !anySuccess, `statuses ${statuses.join(",")} (the limit is 8 a minute: a 429 is expected by the 9th request${got429 ? "" : "; none seen"})`);
    });
  }

  // 9. Cookies an anonymous visitor received over all of the above.
  checks.push(...judgeCookies(cookies, https));

  return {
    checks,
    requests,
    failed: checks.filter((c) => c.level === "fail").length,
    warned: checks.filter((c) => c.level === "warn").length,
  };
}

export function formatReport(base: string, report: SmokeReport): string {
  const mark: Record<Level, string> = { pass: "PASS", fail: "FAIL", warn: "WARN", info: "INFO" };
  const lines = report.checks.map((c) => `${mark[c.level]}  ${c.name}: ${c.detail}`);
  return [
    `Smoke test of ${base} (anonymous, read-only; ${report.requests} requests)`,
    ...lines,
    "",
    `${report.checks.length} checks: ${report.checks.filter((c) => c.level === "pass").length} passed, ${report.failed} failed, ${report.warned} warnings.`,
    report.failed ? "RESULT: FAILED" : "RESULT: OK",
  ].join("\n");
}
