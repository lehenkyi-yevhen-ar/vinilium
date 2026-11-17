/**
 * Security headers for every response. Pure functions (no framework imports), so next.config.ts and the unit tests share them.
 *
 * CSP is deliberately REPORT-ONLY for now: Next.js and the design-system bootstrap rely on inline scripts, so the policy below
 * allows 'unsafe-inline' for scripts and styles and only forbids everything else (other origins, objects, framing, base-uri
 * tricks). It reports what it would block to /api/csp-report. Moving to an enforcing, nonce-based policy is a later step once
 * the reports are clean (see docs/operations.md).
 *
 * HSTS is opt-in (HSTS_MAX_AGE_SECONDS) because it must only be switched on once the WHOLE site is confirmed to work over HTTPS;
 * browsers remember it for the full max-age.
 */

export interface Header {
  key: string;
  value: string;
}

export interface HeaderOptions {
  /** `next dev` needs eval (source maps / HMR) and websockets; production does not. */
  dev?: boolean;
  /** HSTS_MAX_AGE_SECONDS: unset or invalid = no HSTS header. */
  hstsMaxAgeSeconds?: string | undefined;
  /** HSTS_INCLUDE_SUBDOMAINS=1 */
  hstsIncludeSubdomains?: boolean;
}

export const CSP_REPORT_PATH = "/api/csp-report";

export function contentSecurityPolicy({ dev = false }: Pick<HeaderOptions, "dev"> = {}): string {
  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    // Cover art comes through our own image proxy (same origin), never straight from Discogs.
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
    { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy({ dev: options.dev }) },
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
