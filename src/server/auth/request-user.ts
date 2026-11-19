import "server-only";
import { getAuth } from "./index";

/**
 * Signed-in user id for an API request, or null. Skips the database when there is no session cookie at all.
 * A failing lookup counts as signed out (the caller then answers 401) instead of crashing the request.
 */
export async function getRequestUserId(headers: Headers): Promise<string | null> {
  if (!(headers.get("cookie") ?? "").includes("session_token")) return null;
  try {
    const session = await getAuth().api.getSession({ headers });
    return session?.user.id ?? null;
  } catch {
    return null;
  }
}

/** The browser labels requests made from other sites; our APIs serve our own pages only. */
export function isCrossSite(request: Request): boolean {
  return request.headers.get("sec-fetch-site") === "cross-site";
}

/**
 * CSRF defence for cookie-authenticated writes: if the browser sent an Origin, it must be this site's own host.
 * (Same-site cookies are `lax`, so this is a second layer, not the only one.)
 */
export function originMatches(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser clients and same-origin GETs
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    const u = new URL(origin);
    // An Origin header is exactly scheme://host[:port]. Anything the parser had to "repair" (a backslash, a percent-encoded dot, a path,
    // userinfo) is not what a browser sends, so it is refused instead of being compared after the repair.
    if (u.origin.toLowerCase() !== origin.toLowerCase()) return false;
    return host !== null && u.host === host.toLowerCase();
  } catch {
    return false;
  }
}
