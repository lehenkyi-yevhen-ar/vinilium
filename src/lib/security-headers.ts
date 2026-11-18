/**
 * Security headers. Pure functions (no framework imports), so next.config.ts, the proxy and the unit tests share them.
 *
 * Two kinds of header:
 *  - the STATIC ones (`securityHeaders`, applied to every response in next.config.ts): nosniff, framing, referrer, permissions, COOP,
 *    and HSTS when asked for;
 *  - the CONTENT-SECURITY-POLICY (`contentSecurityPolicy`, set per request by src/proxy.ts), because a nonce-based policy needs a fresh
 *    random nonce on every page response.
 *
 * The CSP is the strict one in both modes. `CSP_MODE=report-only` (the default) sends it as Content-Security-Policy-Report-Only: it blocks
 * nothing, and violations reach /api/csp-report. `CSP_MODE=enforce` sends the same policy as Content-Security-Policy. Rollout and
 * rollback: docs/operations.md, section 10 and docs/adr/0005-csp-rollout.md.
 *
 * HSTS is opt-in (HSTS_MAX_AGE_SECONDS) because it must only be switched on once the WHOLE site is confirmed to work over HTTPS;
 * browsers remember it for the full max-age.
 */

export interface Header {
  key: string;
  value: string;
}

export interface HeaderOptions {
  /** HSTS_MAX_AGE_SECONDS: unset or invalid = no HSTS header. */
  hstsMaxAgeSeconds?: string | undefined;
  /** HSTS_INCLUDE_SUBDOMAINS=1 */
  hstsIncludeSubdomains?: boolean;
}

export const CSP_REPORT_PATH = "/api/csp-report";

export type CspMode = "report-only" | "enforce";

/** `CSP_MODE`: exactly "enforce" enforces; anything else (unset, a typo, "Enforce ") is the safe default, report-only. */
export function parseCspMode(raw: string | undefined): CspMode {
  return raw === "enforce" ? "enforce" : "report-only";
}

export const cspHeaderName = (mode: CspMode) => (mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only");

/** A fresh, unguessable, per-request nonce: 128 random bits, base64 (the character set CSP and Next.js accept). */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * The policy. Scripts: our own origin plus the per-request nonce (Next.js puts the nonce on its own inline scripts and bundles, and on
 * <Script>); no 'unsafe-inline', no 'strict-dynamic' (every script we load is same-origin: the theme script is a static file, not an
 * inline one). Styles keep 'unsafe-inline' for now: the design system and React emit style="" attributes, which a nonce cannot cover;
 * CSS injection is a much smaller risk than script injection (see the ADR). Cover art comes through our own image proxy, never
 * straight from Discogs, so there is no third-party origin anywhere.
 */
export function contentSecurityPolicy({ dev = false, nonce }: { dev?: boolean; nonce?: string } = {}): string {
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", ...(nonce ? [`'nonce-${nonce}'`] : []), ...(dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:"]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'", ...(dev ? ["ws:", "wss:"] : [])]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
    ["report-uri", [CSP_REPORT_PATH]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

/** A whole number of seconds from 1 to 2 years, or null. */
export function parseHstsMaxAge(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d{1,9}$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return n >= 1 && n <= 63_072_000 ? n : null;
}

export function securityHeaders(options: HeaderOptions = {}): Header[] {
  const headers: Header[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ];
  const maxAge = parseHstsMaxAge(options.hstsMaxAgeSeconds);
  if (maxAge !== null) {
    headers.push({ key: "Strict-Transport-Security", value: `max-age=${maxAge}${options.hstsIncludeSubdomains ? "; includeSubDomains" : ""}` });
  }
  return headers;
}

// ---------------------------------------------------------------------------------------------------------------------------
// CSP violation reports

export const MAX_REPORT_BYTES = 8 * 1024;

export interface CspViolation {
  directive: string;
  blocked: string;
  document: string;
  source: string;
}

const clip = (v: unknown, max = 200) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : "");
/** Strip the query and fragment from a URL: it may carry tokens (e.g. a password-reset link). */
const bare = (v: unknown) => clip(v, 300).split(/[?#]/)[0];

/**
 * Reports arrive in two shapes: the legacy `{"csp-report": {...}}` (application/csp-report) and the Reporting API list
 * `[{"type":"csp-violation","body":{...}}]` (application/reports+json). Anything else yields no violations. Only a few fields are
 * kept, clipped, and URLs lose their query string: a report must not become a way to get junk or tokens into our logs.
 */
export function parseCspReports(payload: unknown): CspViolation[] {
  const items: unknown[] = Array.isArray(payload) ? payload : [payload];
  const out: CspViolation[] = [];
  for (const item of items.slice(0, 10)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const body = (rec["csp-report"] ?? (rec.type === "csp-violation" ? rec.body : null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") continue;
    out.push({
      directive: clip(body["effective-directive"] ?? body.effectiveDirective ?? body["violated-directive"] ?? body.violatedDirective, 80),
      blocked: bare(body["blocked-uri"] ?? body.blockedURL ?? body.blockedUri),
      document: bare(body["document-uri"] ?? body.documentURL ?? body.documentUri),
      source: bare(body["source-file"] ?? body.sourceFile),
    });
  }
  return out;
}
