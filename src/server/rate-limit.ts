import "server-only";
import { isIP } from "node:net";
import { sql } from "drizzle-orm";
import { rateLimit } from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";

/**
 * Our own request limiter (per IP and per user) on the shared `rate_limit` table, using the `app:` key
 * prefix so it never collides with Better Auth's rows. Fixed window; `last_request` stores the window START.
 * One atomic upsert per hit, so it is correct across serverless instances.
 */

/** Our limiter rows live in `rate_limit` under this key prefix (Better Auth uses other keys in the same table). */
export const APP_RATE_LIMIT_PREFIX = "app:";

export interface LimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  /** Seconds until the window resets (>= 1 when blocked). */
  retryAfter: number;
}

export async function hit(
  db: AppDb,
  opts: { key: string; limit: number; windowSec: number; now?: number },
): Promise<LimitResult> {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowSec * 1000;
  const key = `${APP_RATE_LIMIT_PREFIX}${opts.key}`;
  const expired = sql`${now}::bigint - ${rateLimit.lastRequest} >= ${windowMs}::bigint`;

  const [row] = await db
    .insert(rateLimit)
    .values({ id: key, key, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        count: sql`CASE WHEN ${expired} THEN 1 ELSE ${rateLimit.count} + 1 END`,
        lastRequest: sql`CASE WHEN ${expired} THEN ${now}::bigint ELSE ${rateLimit.lastRequest} END`,
      },
    })
    .returning({ count: rateLimit.count, lastRequest: rateLimit.lastRequest });

  const retryAfter = Math.max(1, Math.ceil((row.lastRequest + windowMs - now) / 1000));
  return { allowed: row.count <= opts.limit, count: row.count, limit: opts.limit, retryAfter };
}

/**
 * Best-effort client IP. Assumes a trusted proxy (Vercel) sets these headers; see README "Deployment".
 * Only syntactically valid IPs are accepted, so a forged header cannot inject junk into limiter keys.
 */
export function clientIp(headers: Headers): string {
  const candidates = [
    headers.get("x-vercel-forwarded-for")?.split(",")[0],
    headers.get("x-forwarded-for")?.split(",")[0],
    headers.get("x-real-ip"),
  ];
  for (const c of candidates) {
    const ip = c?.trim();
    if (ip && isIP(ip) !== 0) return ip.toLowerCase();
  }
  return "unknown";
}
