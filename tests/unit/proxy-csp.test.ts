import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * src/proxy.ts: locale negotiation plus the per-request Content-Security-Policy. Runs the real proxy (and next-intl's middleware).
 */

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => vi.stubEnv("NODE_ENV", "production")); // the production policy (development adds eval and websockets)

const call = async (path: string, init: { headers?: Record<string, string> } = {}) => {
  const { default: proxy } = await import("@/proxy");
  return proxy(new NextRequest(`http://localhost${path}`, init));
};
const nonceOf = (csp: string) => csp.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1];

describe("proxy: Content-Security-Policy", () => {
  it("defaults to REPORT-ONLY (blocks nothing) with a strict nonce-based policy", async () => {
    vi.stubEnv("CSP_MODE", "");
    const res = await call("/en/sign-in");
    const csp = res.headers.get("content-security-policy-report-only")!;
    expect(csp).toMatch(/^default-src 'self'; script-src 'self' 'nonce-[A-Za-z0-9+/=]+'; /);
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(csp).not.toMatch(/unsafe-inline.*script-src|script-src[^;]*unsafe-inline/);
  });

  it("CSP_MODE=enforce sends the SAME policy as an enforcing header, and only that one", async () => {
    vi.stubEnv("CSP_MODE", "enforce");
    const res = await call("/en/sign-in");
    expect(res.headers.get("content-security-policy")).toMatch(/script-src 'self' 'nonce-/);
    expect(res.headers.get("content-security-policy-report-only")).toBeNull();
  });

  it("gives every request its own nonce, and hands the same policy to Next.js on the REQUEST (that is how it finds the nonce)", async () => {
    vi.stubEnv("CSP_MODE", "");
    const a = await call("/en/search");
    const b = await call("/en/search");
    const na = nonceOf(a.headers.get("content-security-policy-report-only")!);
    const nb = nonceOf(b.headers.get("content-security-policy-report-only")!);
    expect(na).toBeTruthy();
    expect(na).not.toBe(nb);
    // next-intl rewrites or continues the request; Next.js reads the request headers listed in x-middleware-override-headers
    const overridden = a.headers.get("x-middleware-override-headers") ?? "";
    expect(overridden).toContain("content-security-policy-report-only");
    expect(a.headers.get("x-middleware-request-content-security-policy-report-only")).toContain(`'nonce-${na}'`);
  });

  it("throws away any CSP header the client sent, so a request cannot pick its own nonce", async () => {
    vi.stubEnv("CSP_MODE", "enforce");
    const res = await call("/en/search", { headers: { "content-security-policy": "script-src 'nonce-ATTACKER'", "content-security-policy-report-only": "script-src 'nonce-ATTACKER'" } });
    expect(res.headers.get("content-security-policy")).not.toContain("ATTACKER");
    expect(res.headers.get("x-middleware-request-content-security-policy") ?? "").not.toContain("ATTACKER");
    expect(res.headers.get("x-middleware-request-content-security-policy-report-only") ?? "").not.toContain("ATTACKER");
  });

  it("still negotiates the locale: the bare address redirects to a locale", async () => {
    const res = await call("/");
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toMatch(/\/(uk|en|nb)$/);
  });
});

describe("proxy matcher", () => {
  it("runs on every page path, and skips the API, Next internals and anything with a dot (static files)", async () => {
    const { config } = await import("@/proxy");
    const re = new RegExp(`^${config.matcher[0]}$`);
    for (const page of ["/", "/en", "/en/sign-in", "/uk/search", "/nb/release/123", "/en/master/5", "/nonexistent", "/fr/anything/else"]) expect(re.test(page), page).toBe(true);
    for (const skipped of ["/api/discogs/search", "/_next/static/chunks/a.js", "/_vercel/insights", "/ds/tokens.css", "/theme-init.js", "/favicon.ico", "/robots.txt", "/en/page.html"]) expect(re.test(skipped), skipped).toBe(false);
  });
});
