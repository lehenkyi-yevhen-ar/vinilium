import createMiddleware from "next-intl/middleware";
import { NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { contentSecurityPolicy, cspHeaderName, generateNonce, parseCspMode } from "./lib/security-headers";

const intl = createMiddleware(routing);

/**
 * Next.js 16 renamed `middleware` to `proxy`. Two jobs, for every page request (not the API, Next internals or static files):
 *
 *  1. Locale negotiation and redirects (next-intl).
 *  2. The Content-Security-Policy, with a fresh nonce for THIS request. The policy goes on the REQUEST too: that is how Next.js finds
 *     the nonce and puts it on its own inline scripts, its bundles and `<Script>`. It goes on the RESPONSE as the header the browser
 *     reads: Content-Security-Policy when CSP_MODE=enforce, Content-Security-Policy-Report-Only otherwise (the default). Any CSP header
 *     the client itself sent is thrown away first, so a request cannot choose its own nonce.
 *
 * Every page is rendered per request (the layout reads the session), which is what a nonce needs.
 */
export default function proxy(request: NextRequest) {
  const name = cspHeaderName(parseCspMode(process.env.CSP_MODE));
  const policy = contentSecurityPolicy({ dev: process.env.NODE_ENV !== "production", nonce: generateNonce() });

  const headers = new Headers(request.headers);
  headers.delete("content-security-policy");
  headers.delete("content-security-policy-report-only");
  headers.set(name, policy);

  const response = intl(new NextRequest(request, { headers }));
  response.headers.set(name, policy);
  return response;
}

export const config = {
  // Skip API routes, Next internals and static files (anything with a dot, e.g. /ds/tokens.css). The backslash is doubled on purpose:
  // in a JS string a single "\." is just ".", which turned the dot rule into "skip every path with a character" and left the proxy
  // running on "/" only (found while adding the CSP: every other page was served without it).
  matcher: ["/((?!api|_next|_vercel|ds|.*\\..*).*)"],
};
