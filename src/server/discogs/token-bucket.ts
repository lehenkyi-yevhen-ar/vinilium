import "server-only";
import { eq } from "drizzle-orm";
import type { AppDb } from "@/server/db/types";
import { discogsBucket } from "@/server/db/schema";

export type { AppDb };

/**
 * Discogs documents 25 requests/min for unauthenticated and 60/min for authenticated clients. We do NOT
 * hard-code 60: until the first response tells us the real limit (X-Discogs-Ratelimit) we run on the
 * conservative figure, then follow the header.
 */
export const DEFAULT_CAPACITY = 25;
const WINDOW_SECONDS = 60;

export interface BucketState {
  tokens: number;
  capacity: number;
  refillPerSec: number;
  updatedAt: number; // epoch ms
  blockedUntil: number | null; // epoch ms
}

export type TakeResult =
  | { ok: true; state: BucketState }
  | { ok: false; retryAfterSec: number; state: BucketState };

export const initialState = (now: number): BucketState => ({
  tokens: DEFAULT_CAPACITY,
  capacity: DEFAULT_CAPACITY,
  refillPerSec: DEFAULT_CAPACITY / WINDOW_SECONDS,
  updatedAt: now,
  blockedUntil: null,
});

export function refill(s: BucketState, now: number): BucketState {
  const elapsed = Math.max(0, (now - s.updatedAt) / 1000);
  return { ...s, tokens: Math.min(s.capacity, s.tokens + elapsed * s.refillPerSec), updatedAt: now };
}

/**
 * Take `cost` tokens, leaving at least `reserve` untouched (images use a reserve so a page of thumbnails
 * cannot starve API calls). Pure: persistence is below.
 */
export function take(state: BucketState, now: number, cost = 1, reserve = 0): TakeResult {
  if (state.blockedUntil !== null && state.blockedUntil > now) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((state.blockedUntil - now) / 1000)), state };
  }
  const s = refill({ ...state, blockedUntil: null }, now);
  if (s.tokens - cost >= Math.min(reserve, s.capacity - cost)) {
    return { ok: true, state: { ...s, tokens: s.tokens - cost } };
  }
  const missing = cost + Math.min(reserve, s.capacity - cost) - s.tokens;
  return { ok: false, retryAfterSec: Math.max(1, Math.ceil(missing / s.refillPerSec)), state: s };
}

export interface ObservedLimit {
  limit: number | null;
  remaining: number | null;
}

/**
 * Fold Discogs' own numbers into our state: it is the source of truth for the limit and what is left.
 * When the limit changes (first response, or Discogs changes the rule) we adopt `remaining` outright, because our
 * default was only a guess; afterwards `remaining` can only LOWER our token count (other instances share the budget).
 */
export function applyObserved(s: BucketState, o: ObservedLimit, now: number): BucketState {
  let next = refill(s, now);
  const limitChanged = o.limit !== null && o.limit >= 1 && o.limit <= 10_000 && o.limit !== next.capacity;
  if (limitChanged) {
    next = { ...next, capacity: o.limit as number, refillPerSec: (o.limit as number) / WINDOW_SECONDS };
  }
  if (o.remaining !== null && o.remaining >= 0) {
    next = { ...next, tokens: limitChanged ? o.remaining : Math.min(next.tokens, o.remaining) };
  }
  return { ...next, tokens: Math.min(next.tokens, next.capacity) };
}

export function parseRateHeaders(h: Headers): { limit: number | null; used: number | null; remaining: number | null } {
  const num = (name: string) => {
    const v = h.get(name);
    const n = v === null ? NaN : Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };
  return {
    limit: num("x-discogs-ratelimit"),
    used: num("x-discogs-ratelimit-used"),
    remaining: num("x-discogs-ratelimit-remaining"),
  };
}

// ---- persistence (one row per API origin; row lock makes it safe across serverless instances) ----

const toState = (r: typeof discogsBucket.$inferSelect): BucketState => ({
  tokens: r.tokens,
  capacity: r.capacity,
  refillPerSec: r.refillPerSec,
  updatedAt: r.updatedAt.getTime(),
  blockedUntil: r.blockedUntil ? r.blockedUntil.getTime() : null,
});

const toRow = (s: BucketState) => ({
  tokens: s.tokens,
  capacity: s.capacity,
  refillPerSec: s.refillPerSec,
  updatedAt: new Date(s.updatedAt),
  blockedUntil: s.blockedUntil === null ? null : new Date(s.blockedUntil),
});

async function withLockedBucket<T>(
  db: AppDb,
  id: string,
  now: number,
  fn: (s: BucketState) => { next: BucketState; result: T; extra?: Partial<typeof discogsBucket.$inferInsert> },
): Promise<T> {
  return db.transaction(async (tx) => {
    const init = initialState(now);
    await tx.insert(discogsBucket).values({ id, ...toRow(init) }).onConflictDoNothing();
    const [row] = await tx.select().from(discogsBucket).where(eq(discogsBucket.id, id)).for("update");
    const { next, result, extra } = fn(toState(row));
    await tx
      .update(discogsBucket)
      .set({ ...toRow(next), ...extra })
      .where(eq(discogsBucket.id, id));
    return result;
  });
}

export async function acquireToken(
  db: AppDb,
  opts: { id: string; cost?: number; reserveFraction?: number; now?: number },
): Promise<TakeResult> {
  const now = opts.now ?? Date.now();
  return withLockedBucket(db, opts.id, now, (s) => {
    const reserve = (opts.reserveFraction ?? 0) * s.capacity;
    const r = take(s, now, opts.cost ?? 1, reserve);
    return { next: r.state, result: r };
  });
}

export async function recordObserved(
  db: AppDb,
  opts: { id: string; limit: number | null; used: number | null; remaining: number | null; now?: number },
): Promise<void> {
  const now = opts.now ?? Date.now();
  await withLockedBucket(db, opts.id, now, (s) => ({
    next: applyObserved(s, opts, now),
    result: undefined,
    extra: {
      observedLimit: opts.limit,
      observedRemaining: opts.remaining,
      observedAt: new Date(now),
    },
  }));
}

/**
 * After a 429: nobody (on any instance) calls Discogs again until `seconds` have passed. When the block ends exactly
 * one token is available: a single probe, not a burst.
 */
export async function blockFor(db: AppDb, opts: { id: string; seconds: number; now?: number }): Promise<void> {
  const now = opts.now ?? Date.now();
  await withLockedBucket(db, opts.id, now, (s) => ({
    next: { ...refill(s, now), tokens: 1, blockedUntil: now + opts.seconds * 1000 },
    result: undefined,
  }));
}

export async function readBucket(db: AppDb, id: string) {
  const [row] = await db.select().from(discogsBucket).where(eq(discogsBucket.id, id));
  return row ?? null;
}
