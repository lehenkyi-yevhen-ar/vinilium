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
    console.error("[auth] getSession failed", error);
    return null;
  }
});

/** Only allow same-site relative paths as post-login redirect targets (blocks open redirects). */
export function safeNextPath(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.includes("\\")) return null;
  return v;
}
