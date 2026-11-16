import "server-only";
import { and, eq, gt, like, lt } from "drizzle-orm";
import { discogsCache, rateLimit } from "@/server/db/schema";
import { APP_RATE_LIMIT_PREFIX } from "@/server/rate-limit";
import type { AppDb } from "./token-bucket";

/**
 * TTL-bound cache of our normalised Discogs data. Rows never outlive `expires_at`: reads ignore expired rows, every
 * write deletes expired rows (the Terms forbid storing Content longer than necessary), and the cron job is a backstop
 * for quiet periods.
 */

/**
 * Bump when the shape or meaning of cached payloads changes, so rows written by older code are never served.
 * v2 (2026-11-16): searches became vinyl-only and group by master; versions are vinyl-only.
 */
export const CACHE_KEY_VERSION = "v2";

/** Cache key: versioned, scoped to the API origin, params sorted so equivalent requests share a row. */
export function cacheKey(origin: string, kind: "search" | "versions" | "release" | "master", params: Record<string, string | number>): string {
  const canon = Object.entries(params)
    .map(([k, v]) => [k, String(v).normalize("NFC").trim().replace(/\s+/g, " ")] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${encodeURIComponent(k === "q" || k === "track" || k === "artist" || k === "by" ? v.toLowerCase() : v)}`)
    .join("&");
  return `${CACHE_KEY_VERSION}|${origin}|${kind}|${canon}`;
}

export interface CacheHit<T> {
  payload: T;
  fetchedAt: Date;
  expiresAt: Date;
}

export async function getCached<T>(db: AppDb, key: string, now = Date.now()): Promise<CacheHit<T> | null> {
  const [row] = await db
    .select()
    .from(discogsCache)
    .where(and(eq(discogsCache.key, key), gt(discogsCache.expiresAt, new Date(now))));
  return row ? { payload: row.payload as T, fetchedAt: row.fetchedAt, expiresAt: row.expiresAt } : null;
}

export async function putCached(
  db: AppDb,
  key: string,
  payload: unknown,
  ttlSeconds: number,
  now = Date.now(),
): Promise<{ fetchedAt: Date; expiresAt: Date }> {
  const fetchedAt = new Date(now);
  const expiresAt = new Date(now + ttlSeconds * 1000);
  await db
    .insert(discogsCache)
    .values({ key, payload, fetchedAt, expiresAt })
    .onConflictDoUpdate({ target: discogsCache.key, set: { payload, fetchedAt, expiresAt } });
  return { fetchedAt, expiresAt };
}

/** Deletes cache rows past `expires_at` (a single indexed DELETE). Run after every cache write. */
export async function purgeExpiredCache(db: AppDb, now = Date.now()): Promise<number> {
  const rows = await db.delete(discogsCache).where(lt(discogsCache.expiresAt, new Date(now))).returning({ key: discogsCache.key });
  return rows.length;
}

export interface PurgeResult {
  cacheRows: number;
  rateLimitRows: number;
}

const RATE_LIMIT_RETENTION_MS = 60 * 60 * 1000;

/**
 * Delete everything past its time. Cache rows go the moment they expire (no grace period: no permanent
 * copies); our limiter counters go an hour after their window ended.
 */
export async function purgeExpired(db: AppDb, now = Date.now()): Promise<PurgeResult> {
  const cacheRows = await purgeExpiredCache(db, now);
  const limits = await db
    .delete(rateLimit)
    .where(and(like(rateLimit.key, `${APP_RATE_LIMIT_PREFIX}%`), lt(rateLimit.lastRequest, now - RATE_LIMIT_RETENTION_MS)))
    .returning({ id: rateLimit.id });
  return { cacheRows, rateLimitRows: limits.length };
}
