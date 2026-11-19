import "server-only";
import { limits } from "@/server/limits";
import { hit, LIMITER_RETRY_AFTER_SECONDS, LimiterUnavailableError } from "@/server/rate-limit";
import type { AppDb } from "./token-bucket";

export interface ColdLimit {
  allowed: boolean;
  retryAfter: number;
}

/**
 * A per-person ceiling on COLD Discogs fetches (uncached lookups in a batch): one unit is taken just before each upstream call a
 * batch is about to make. Cached data never reaches it. The app-wide 60/min budget is shared by everybody; this keeps one person
 * from spending all of it. See limits().coldFetch for the number and why.
 */
export function coldLimiter(db: AppDb, userId: string, opts: { limit?: number; now?: () => number } = {}): () => Promise<ColdLimit> {
  const limit = opts.limit ?? limits().coldFetch.user;
  return async () => {
    try {
      const r = await hit(db, { key: `cold:user:${userId}`, limit, windowSec: 60, now: opts.now?.() });
      return { allowed: r.allowed, retryAfter: r.retryAfter };
    } catch (error) {
      // fail CLOSED: with no counter there is no way to know the person is within their allowance, and an uncounted fetch spends the shared Discogs budget
      if (error instanceof LimiterUnavailableError) return { allowed: false, retryAfter: LIMITER_RETRY_AFTER_SECONDS };
      throw error;
    }
  };
}
