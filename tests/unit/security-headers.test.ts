import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, CSP_REPORT_PATH, cspHeaderName, generateNonce, parseCspMode, parseCspReports, parseHstsMaxAge, securityHeaders } from "@/lib/security-headers";

const byKey = (h: Array<{ key: string; value: string }>) => Object.fromEntries(h.map((x) => [x.key, x.value]));

describe("securityHeaders", () => {
  it("always sets the basic hardening headers", () => {
    const h = byKey(securityHeaders());
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toMatch(/camera=\(\).*microphone=\(\).*geolocation=\(\)/);
    expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin-allow-popups");
  });

  it("has NO HSTS unless it is switched on, and then only with a sane max-age", () => {
    expect(byKey(securityHeaders())["Strict-Transport-Security"]).toBeUndefined();
    expect(byKey(securityHeaders({ hstsMaxAgeSeconds: "" }))["Strict-Transport-Security"]).toBeUndefined();
    expect(byKey(securityHeaders({ hstsMaxAgeSeconds: "abc" }))["Strict-Transport-Security"]).toBeUndefined();
    expect(byKey(securityHeaders({ hstsMaxAgeSeconds: "0" }))["Strict-Transport-Security"]).toBeUndefined();
    expect(byKey(securityHeaders({ hstsMaxAgeSeconds: "999999999" }))["Strict-Transport-Security"]).toBeUndefined(); // more than two years
    expect(byKey(securityHeaders({ hstsMaxAgeSeconds: "300" }))["Strict-Transport-Security"]).toBe("max-age=300");
    expect(byKey(securityHeaders({ hstsMaxAgeSeconds: "31536000", hstsIncludeSubdomains: true }))["Strict-Transport-Security"]).toBe("max-age=31536000; includeSubDomains");
    expect(parseHstsMaxAge(" 600 ")).toBe(600);
  });

  it("carries NO Content-Security-Policy: that needs a per-request nonce and is set by src/proxy.ts", () => {
    const h = byKey(securityHeaders());
    expect(h["Content-Security-Policy-Report-Only"]).toBeUndefined();
    expect(h["Content-Security-Policy"]).toBeUndefined();
  });
});

describe("CSP mode", () => {
  it("is report-only unless it is exactly 'enforce' (a typo can never turn enforcement on or off by accident)", () => {
    expect(parseCspMode(undefined)).toBe("report-only");
    expect(parseCspMode("")).toBe("report-only");
    expect(parseCspMode("report-only")).toBe("report-only");
    for (const bad of ["Enforce", "ENFORCE", " enforce", "enforce ", "true", "1", "on", "enforcing"]) expect(parseCspMode(bad), bad).toBe("report-only");
    expect(parseCspMode("enforce")).toBe("enforce");
  });

  it("names the header the browser reads", () => {
    expect(cspHeaderName("enforce")).toBe("Content-Security-Policy");
    expect(cspHeaderName("report-only")).toBe("Content-Security-Policy-Report-Only");
  });
});

describe("generateNonce", () => {
  it("is 128 random bits in base64, different every time, and in the form Next.js and CSP accept", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const n = generateNonce();
      expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/); // 16 bytes
      seen.add(n);
    }
    expect(seen.size).toBe(500);
  });
});

describe("contentSecurityPolicy", () => {
  it("only allows our own origin, forbids objects, framing and base-uri tricks, and reports", () => {
    const csp = contentSecurityPolicy({ nonce: "abc" });
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain(`report-uri ${CSP_REPORT_PATH}`);
    expect(csp).not.toMatch(/https?:\/\//); // no third-party origin is allowed anywhere
    expect(csp).not.toMatch(/\*/);
  });

  it("allows scripts from our origin and the request's nonce ONLY: no unsafe-inline, no unsafe-eval, no strict-dynamic", () => {
    const script = contentSecurityPolicy({ nonce: "AAAAAAAAAAAAAAAAAAAAAA==" }).split("; ").find((d) => d.startsWith("script-src "))!;
    expect(script).toBe("script-src 'self' 'nonce-AAAAAAAAAAAAAAAAAAAAAA=='");
    expect(script).not.toMatch(/unsafe-inline|unsafe-eval|strict-dynamic|data:|blob:/);
  });

  it("keeps style-src 'unsafe-inline' (style attributes cannot carry a nonce) and says so in one place", () => {
    expect(contentSecurityPolicy({ nonce: "x" })).toContain("style-src 'self' 'unsafe-inline'");
  });

  it("allows eval and websockets only in development", () => {
    expect(contentSecurityPolicy({ dev: false, nonce: "x" })).not.toContain("unsafe-eval");
    expect(contentSecurityPolicy({ dev: false, nonce: "x" })).not.toContain("ws:");
    expect(contentSecurityPolicy({ dev: true, nonce: "x" })).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy({ dev: true, nonce: "x" })).toContain("ws:");
  });
});

describe("parseCspReports", () => {
  it("reads the legacy report format and keeps only a few clipped fields, without query strings", () => {
    const out = parseCspReports({
      "csp-report": {
        "document-uri": "https://example.test/en/reset-password?token=SECRET123",
        "violated-directive": "img-src",
        "effective-directive": "img-src",
        "blocked-uri": "https://evil.test/x.png?leak=1#frag",
        "source-file": "https://example.test/_next/chunk.js",
        "original-policy": "default-src 'self'; ...",
        "script-sample": "alert(1)",
      },
    });
    expect(out).toEqual([{ directive: "img-src", blocked: "https://evil.test/x.png", document: "https://example.test/en/reset-password", source: "https://example.test/_next/chunk.js" }]);
    expect(JSON.stringify(out)).not.toMatch(/SECRET123|leak|alert/);
  });

  it("reads the Reporting API format (a list)", () => {
    const out = parseCspReports([{ type: "csp-violation", body: { effectiveDirective: "script-src", blockedURL: "inline", documentURL: "https://example.test/en" } }, { type: "network-error", body: {} }]);
    expect(out).toEqual([{ directive: "script-src", blocked: "inline", document: "https://example.test/en", source: "" }]);
  });

  it("ignores junk, clips long values, strips control characters and caps the number of reports", () => {
    expect(parseCspReports(null)).toEqual([]);
    expect(parseCspReports("x")).toEqual([]);
    expect(parseCspReports({ foo: 1 })).toEqual([]);
    const long = parseCspReports({ "csp-report": { "violated-directive": "a".repeat(5000), "blocked-uri": "x\nFAKE LOG LINE\u0000" } });
    expect(long[0].directive.length).toBeLessThanOrEqual(80);
    expect(long[0].blocked).not.toMatch(/[\n\u0000]/); // no log-line injection
    expect(parseCspReports(Array.from({ length: 50 }, () => ({ "csp-report": { "violated-directive": "img-src" } })))).toHaveLength(10);
  });
});
