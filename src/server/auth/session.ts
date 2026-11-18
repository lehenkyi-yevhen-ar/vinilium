import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { getAuth } from "./index";

/**
 * Data-access-layer helper: the current session (or null). Deduped per request.
 * A failure to reach the database is logged and treated as "signed out" so public pages
 * keep rendering; protected pages then redirect to sign-in instead of crashing.
 */
export const getSession = cache(async () => {
  // Outside the try/catch on purpose: reading request headers can throw Next's internal
  // "dynamic server usage" signal, which must propagate and never be swallowed.
  const requestHeaders = await headers();
  try {
    return await getAuth().api.getSession({ headers: requestHeaders });
  } catch (error) {
    // Name and code only: an error from the database or the auth library can carry request details we must not write to a log.
    const e = error as { name?: unknown; code?: unknown } | null;
    console.error(`[auth] getSession failed name=${String(e?.name ?? "unknown").slice(0, 60)} code=${String(e?.code ?? "-").slice(0, 30)}`);
    return null;
  }
});

/**
 * Only allow same-site relative paths as post-login redirect targets (blocks open redirects). A browser's URL parser silently DROPS tab,
 * newline and carriage-return characters and treats a backslash as a slash, so "/\t/evil.example" is really "//evil.example": every control
 * character and backslash is refused, and the result must still resolve to the same origin when parsed.
 * (Every use also prefixes the locale, which is a second layer, not the only one.)
 */
export function safeNextPath(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v || v.length > 2000 || !v.startsWith("/") || v.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(v)) return null;
  try {
    return new URL(v, "http://app.invalid").origin === "http://app.invalid" ? v : null;
  } catch {
    return null;
  }
}
