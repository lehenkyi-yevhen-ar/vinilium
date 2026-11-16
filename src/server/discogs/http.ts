import "server-only";
import { z } from "zod";
import type { ApiErrorBody, DiscogsResult } from "@/lib/discogs/types";
import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";
import { limits } from "@/server/limits";
import { clientIp, hit } from "@/server/rate-limit";
import { MAX_SEARCH_PAGES, MAX_VERSION_PAGES } from "./config";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export function errorResponse(status: number, body: ApiErrorBody): Response {
  const headers: Record<string, string> = { ...NO_STORE };
  if (body.retryAfter !== undefined) headers["Retry-After"] = String(body.retryAfter);
  return Response.json(body, { status, headers });
}

/** Signed-in user id, or null. Skips the database entirely when there is no session cookie. */
async function optionalUserId(headers: Headers): Promise<string | null> {
  if (!(headers.get("cookie") ?? "").includes("session_token")) return null;
  try {
    const s = await getAuth().api.getSession({ headers });
    return s?.user.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Our own limits, per IP AND per signed-in user. Returns a ready 429 response when blocked, else null.
 * Anonymous callers are limited by IP only.
 */
export async function guard(request: Request, scope: "search" | "image"): Promise<Response | null> {
  const db = getDb();
  const cfg = limits();
  const ip = clientIp(request.headers);
  const byIp = await hit(db, { key: `${scope}:ip:${ip}`, limit: cfg[scope].ip, windowSec: cfg.windowSec });
  let blocked = byIp.allowed ? null : byIp;

  const userId = await optionalUserId(request.headers);
  if (userId) {
    const byUser = await hit(db, { key: `${scope}:user:${userId}`, limit: cfg[scope].user, windowSec: cfg.windowSec });
    if (!byUser.allowed && (!blocked || byUser.retryAfter > blocked.retryAfter)) blocked = byUser;
  }
  return blocked ? errorResponse(429, { error: "rate_limited", scope: "app", retryAfter: blocked.retryAfter }) : null;
}

/** DiscogsResult -> HTTP. `throttled` carries `retryAfter` so the UI can show a countdown. */
export function respond<T>(result: DiscogsResult<T>): Response {
  if (result.ok) {
    return Response.json({ data: result.data, cached: result.cached, fetchedAt: result.fetchedAt }, { headers: NO_STORE });
  }
  switch (result.error) {
    case "throttled":
      return errorResponse(429, { error: "throttled", scope: "discogs", retryAfter: result.retryAfter ?? 5 });
    case "not_found":
      return errorResponse(404, { error: "not_found" });
    case "unconfigured":
      return errorResponse(503, { error: "unconfigured", message: "Discogs credentials are not configured." });
    default:
      return errorResponse(502, { error: "upstream", message: "Discogs is not responding as expected." });
  }
}

export const searchQuerySchema = z.object({
  q: z.string().transform((s) => s.normalize("NFC").trim().replace(/\s+/g, " ")).pipe(z.string().min(1).max(100)),
  mode: z.enum(["track", "artist", "master"]),
  page: z.coerce.number().int().min(1).max(MAX_SEARCH_PAGES).default(1),
});

export const versionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(MAX_VERSION_PAGES).default(1),
});

/** Discogs ids are positive integers; anything else is rejected before it reaches a URL. */
export const idSchema = z.string().regex(/^[1-9]\d{0,9}$/).transform(Number);

export const badRequest = (message: string) => errorResponse(400, { error: "bad_request", message });
