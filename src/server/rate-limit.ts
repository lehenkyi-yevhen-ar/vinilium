import "server-only";
import { isIP } from "node:net";
import { sql } from "drizzle-orm";
import { rateLimit } from "@/server/db/schema";
import type { AppDb } from "@/server/db/types";

/**
 * Our own request limiter (per IP and per user) on the shared `rate_limit` table, using the `app:` key
 * prefix so it never collides with Better Auth's rows. Fixed window; `last_request` stores the window START.
 * One atomic upsert per hit, so it is correct across serverless instances.
 *
 * Failure policy (decided per caller, see docs/operations.md section 17a): when the database cannot be written, hit() throws LimiterUnavailableError and
 * the CALLER decides. Search, images and lists answer a structured 503 with Retry-After (fail CLOSED: no request is let through unchecked); the
 * cold-fetch allowance answers "not allowed, retry in 2 s" (fail closed: it protects the shared Discogs budget); the CSP report endpoint carries on
 * (fail open: it protects nothing but log volume). Better Auth's own limiter on the auth endpoints is not ours and is untouched: it retries a lost
 * creation race itself, and a database error there fails the request rather than skipping the check.
 */

/** Our limiter rows live in `rate_limit` under this key prefix (Better Auth uses other keys in the same table). */
export const APP_RATE_LIMIT_PREFIX = "app:";

/** The limiter could not read or write its counter (database error). Never "allowed": callers must choose how to fail. */
export class LimiterUnavailableError extends Error {
  constructor(cause: unknown) {
    super("The request limiter could not reach its counter", { cause });
    this.name = "LimiterUnavailableError";
  }
}

/** What an answer that fails closed tells the caller to wait, in seconds. */
export const LIMITER_RETRY_AFTER_SECONDS = 2;

/** The SQLSTATE of a database error, looking through drizzle's "Failed query" wrapper (the real error is in `cause`). */
function sqlState(error: unknown): string | undefined {
  for (let e: unknown = error, depth = 0; e && typeof e === "object" && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}

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

  // The row id is a fresh random one, NOT the key. The table has two unique indexes (the primary key `id` and `key`) and `ON CONFLICT (key)` only
  // arbitrates the second: with id = key, two requests creating the same counter at the same instant could collide on the primary key instead
  // and fail with 23505 (seen in CI: the first thumbnails of a page, loaded in parallel). With a random id the only possible collision is on
  // `key`, which ON CONFLICT turns into an update. This is also what Better Auth does for its own rows in this table (its adapter generates
  // the id and it only ever looks rows up by `key`), and rows already stored with id = key keep working: they are matched by `key`.
  const upsert = () =>
    db
      .insert(rateLimit)
      .values({ id: crypto.randomUUID(), key, count: 1, lastRequest: now })
      .onConflictDoUpdate({
        target: rateLimit.key,
        set: {
          count: sql`CASE WHEN ${expired} THEN 1 ELSE ${rateLimit.count} + 1 END`,
          lastRequest: sql`CASE WHEN ${expired} THEN ${now}::bigint ELSE ${rateLimit.lastRequest} END`,
        },
      })
      .returning({ count: rateLimit.count, lastRequest: rateLimit.lastRequest });

  let row: { count: number; lastRequest: number };
  try {
    try {
      [row] = await upsert();
    } catch (error) {
      if (sqlState(error) !== "23505") throw error;
      [row] = await upsert(); // a unique violation can only be a lost creation race: the row exists now, so one retry takes the update path
    }
  } catch (error) {
    throw new LimiterUnavailableError(error);
  }

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
