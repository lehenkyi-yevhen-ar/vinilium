import "server-only";
import { and, eq, gt, like, lt } from "drizzle-orm";
import { discogsCache, rateLimit } from "@/server/db/schema";
import { APP_RATE_LIMIT_PREFIX } from "@/server/rate-limit";
import type { AppDb } from "./token-bucket";

/**
 * TTL-bound cache of our normalised Discogs data. Rows are never refreshed in place and never outlive
 * `expires_at`: reads ignore expired rows, writes replace them, and `purgeExpired` deletes them.
 */

/** Cache key: versioned, scoped to the API origin, params sorted so equivalent requests share a row. */
export function cacheKey(origin: string, kind: "search" | "versions" | "release", params: Record<string, string | number>): string {
  const canon = Object.entries(params)
    .map(([k, v]) => [k, String(v).normalize("NFC").trim().replace(/\s+/g, " ")] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${encodeURIComponent(k === "q" || k === "track" || k === "artist" ? v.toLowerCase() : v)}`)
    .join("&");
  return `v1|${origin}|${kind}|${canon}`;
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
  const cache = await db.delete(discogsCache).where(lt(discogsCache.expiresAt, new Date(now))).returning({ key: discogsCache.key });
  const limits = await db
    .delete(rateLimit)
    .where(and(like(rateLimit.key, `${APP_RATE_LIMIT_PREFIX}%`), lt(rateLimit.lastRequest, now - RATE_LIMIT_RETENTION_MS)))
    .returning({ id: rateLimit.id });
  return { cacheRows: cache.length, rateLimitRows: limits.length };
}

/** Roughly 1 in 50 writes also purges, so cleanup happens even if the scheduled job is not configured yet. */
export function shouldPurgeOpportunistically(random = Math.random): boolean {
  return random() < 0.02;
}
