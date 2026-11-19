import "server-only";
import { count, lt, type SQL } from "drizzle-orm";
import { discogsCache, rateLimit, session, verification } from "@/server/db/schema";
import { purgeExpiredCache } from "@/server/discogs/cache";
import type { AppDb } from "@/server/db/types";

/**
 * The retention rules of docs/data-inventory.md, in one place. Run daily by /api/cron/purge.
 *
 *  - Discogs cache rows: the moment they expire (no grace: the Terms forbid keeping content longer than necessary).
 *  - Verification rows (single-use email links; `identifier` can be an email address): once expired.
 *  - Sessions (token, IP address, user agent): once expired. They no longer authenticate anyone, and the person simply signs in again.
 *  - Rate-limit counters, ours AND Better Auth's (their keys contain IP addresses and user ids): once their window ended an hour ago.
 *    Deleting a counter whose window is over changes nothing for anyone.
 *
 * It never touches `user`, `account` or `user_items`: people's lists and accounts are only deleted by the person (or on request).
 * `dryRun` only counts what a real run would delete.
 */

export const RATE_LIMIT_RETENTION_MS = 60 * 60 * 1000;

export interface RetentionResult {
  dryRun: boolean;
  cacheRows: number;
  verificationRows: number;
  sessionRows: number;
  rateLimitRows: number;
}

export async function purgeRetention(db: AppDb, opts: { now?: number; dryRun?: boolean } = {}): Promise<RetentionResult> {
  const now = opts.now ?? Date.now();
  const at = new Date(now);
  const dryRun = opts.dryRun === true;
  const countOf = async (table: typeof discogsCache | typeof verification | typeof session | typeof rateLimit, where: SQL) => {
    const [{ n }] = await db.select({ n: count() }).from(table).where(where);
    return Number(n);
  };

  if (dryRun) {
    return {
      dryRun,
      cacheRows: await countOf(discogsCache, lt(discogsCache.expiresAt, at)),
      verificationRows: await countOf(verification, lt(verification.expiresAt, at)),
      sessionRows: await countOf(session, lt(session.expiresAt, at)),
      rateLimitRows: await countOf(rateLimit, lt(rateLimit.lastRequest, now - RATE_LIMIT_RETENTION_MS)),
    };
  }
  const cacheRows = await purgeExpiredCache(db, now);
  const verificationRows = (await db.delete(verification).where(lt(verification.expiresAt, at)).returning({ id: verification.id })).length;
  const sessionRows = (await db.delete(session).where(lt(session.expiresAt, at)).returning({ id: session.id })).length;
  const rateLimitRows = (await db.delete(rateLimit).where(lt(rateLimit.lastRequest, now - RATE_LIMIT_RETENTION_MS)).returning({ id: rateLimit.id })).length;
  return { dryRun, cacheRows, verificationRows, sessionRows, rateLimitRows };
}
