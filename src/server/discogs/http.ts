import "server-only";
import { z } from "zod";
import type { ApiErrorBody, DiscogsResult } from "@/lib/discogs/types";
import { getRequestUserId, isCrossSite } from "@/server/auth/request-user";
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

/**
 * Gate for every Discogs endpoint: (1) only our own pages may call it (browsers label cross-site requests), (2) the caller
 * must be signed in, (3) our own limits, per IP AND per user. Returns a ready error response, or null to proceed.
 * Sign-in is required because the Terms forbid giving third parties access to the Content and the 60/min budget is shared.
 */
export async function guard(request: Request, scope: "search" | "image"): Promise<Response | null> {
  if (isCrossSite(request)) {
    return errorResponse(403, { error: "forbidden", message: "This endpoint is only available to this site's own pages." });
  }
  const userId = await getRequestUserId(request.headers);
  if (!userId) return errorResponse(401, { error: "unauthorized", message: "Sign in to search." });

  const db = getDb();
  const cfg = limits();
  const ip = clientIp(request.headers);
  const byIp = await hit(db, { key: `${scope}:ip:${ip}`, limit: cfg[scope].ip, windowSec: cfg.windowSec });
  const byUser = await hit(db, { key: `${scope}:user:${userId}`, limit: cfg[scope].user, windowSec: cfg.windowSec });
  const blocked = [byIp, byUser].filter((r) => !r.allowed).sort((a, b) => b.retryAfter - a.retryAfter)[0];
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
  mode: z.enum(["track", "artist", "album"]),
  /** Optional artist to narrow a track or album search to. */
  by: z
    .string()
    .transform((s) => s.normalize("NFC").trim().replace(/\s+/g, " "))
    .pipe(z.string().max(100))
    .optional()
    .transform((s) => s || undefined),
  page: z.coerce.number().int().min(1).max(MAX_SEARCH_PAGES).default(1),
});

const optionalText = z
  .string()
  .transform((s) => s.normalize("NFC").trim().replace(/\s+/g, " "))
  .pipe(z.string().max(100))
  .optional()
  .transform((s) => s || undefined);

export const versionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(MAX_VERSION_PAGES).default(1),
  country: optionalText,
  label: optionalText,
  released: z
    .string()
    .regex(/^\d{4}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

/** `?ids=1,2,3`: one to MAX_MASTERS_PER_BATCH distinct master ids. */
export const masterIdsSchema = z
  .string()
  .regex(/^[1-9]\d{0,9}(,[1-9]\d{0,9}){0,11}$/)
  .transform((s) => [...new Set(s.split(",").map(Number))]);

/** Discogs ids are positive integers; anything else is rejected before it reaches a URL. */
export const idSchema = z.string().regex(/^[1-9]\d{0,9}$/).transform(Number);

export const badRequest = (message: string) => errorResponse(400, { error: "bad_request", message });
