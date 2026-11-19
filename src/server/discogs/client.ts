import "server-only";
import { apiBase, bucketId, userAgent } from "./config";
import { resolveDiscogsAuth } from "./credentials";
import { count } from "@/server/metrics";
import { acquireToken, blockFor, parseRateHeaders, recordObserved, type AppDb } from "./token-bucket";

export interface RateInfo {
  limit: number | null;
  used: number | null;
  remaining: number | null;
}

export type RequestOutcome =
  | { ok: true; json: unknown; status: number; rate: RateInfo }
  | { ok: false; kind: "throttled"; retryAfter: number }
  | { ok: false; kind: "not_found" }
  | { ok: false; kind: "unconfigured" }
  | { ok: false; kind: "upstream"; status: number | null };

export interface ClientDeps {
  db: AppDb;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  /** Longest we will sleep for ONE wait (token refill or backoff) before giving up with `throttled`. */
  maxSingleWaitMs?: number;
  /** Total time we are willing to spend waiting inside one request. */
  maxTotalWaitMs?: number;
  maxRetries?: number;
  requestTimeoutMs?: number;
}

const DEFAULTS = { maxSingleWaitMs: 3_000, maxTotalWaitMs: 8_000, maxRetries: 3, requestTimeoutMs: 10_000 };
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 8_000;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exponential backoff with FULL jitter: random in [0, min(cap, base * 2^attempt)]. */
export function backoffMs(attempt: number, random: () => number): number {
  return Math.round(random() * Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt));
}

/** Retry-After is either seconds or an HTTP date. Returns seconds, or null. */
export function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - now) / 1000));
}

export function discogsHeaders(authHeader: string): Record<string, string> {
  return {
    Authorization: authHeader,
    "User-Agent": userAgent(),
    Accept: "application/vnd.discogs.v2.discogs+json",
  };
}

/** GET {api}/{path}?{params} with auth, shared throttling, header tracking and 429 backoff. */
export async function discogsGet(path: string, params: Record<string, string | number>, deps: ClientDeps): Promise<RequestOutcome> {
  const auth = resolveDiscogsAuth();
  if (!auth) return { ok: false, kind: "unconfigured" };

  const { db } = deps;
  const f = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? realSleep;
  const clock = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const cfg = { ...DEFAULTS, ...deps };
  const id = bucketId();

  const url = new URL(`${apiBase()}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  let waited = 0;
  let attempt = 0;

  for (;;) {
    // 1. Our own budget first: one shared bucket for every instance.
    const taken = await acquireToken(db, { id, now: clock() });
    if (!taken.ok) {
      const waitMs = taken.retryAfterSec * 1000;
      if (waitMs > cfg.maxSingleWaitMs || waited + waitMs > cfg.maxTotalWaitMs) {
        count("throttled");
        return { ok: false, kind: "throttled", retryAfter: taken.retryAfterSec };
      }
      const jittered = waitMs + Math.round(random() * 250);
      await sleep(jittered);
      waited += jittered;
      continue;
    }

    // 2. The request.
    count("discogs_calls");
    let res: Response;
    try {
      res = await f(url, {
        headers: discogsHeaders(auth.header),
        cache: "no-store",
        signal: AbortSignal.timeout(cfg.requestTimeoutMs),
      });
    } catch {
      if (attempt < cfg.maxRetries - 1) {
        const delay = backoffMs(attempt++, random);
        if (waited + delay <= cfg.maxTotalWaitMs) {
          await sleep(delay);
          waited += delay;
          continue;
        }
      }
      count("upstream_errors");
      return { ok: false, kind: "upstream", status: null };
    }

    // 3. Learn the real limit and what is left, from Discogs itself.
    const rate = parseRateHeaders(res.headers);
    if (rate.limit !== null || rate.remaining !== null) {
      await recordObserved(db, { id, ...rate, now: clock() }).catch(() => {});
    }

    if (res.status === 429) {
      const headerSecs = parseRetryAfter(res.headers.get("retry-after"), clock());
      // Honour Retry-After as a floor, add jittered exponential backoff on top.
      const delay = Math.max((headerSecs ?? 0) * 1000, backoffMs(attempt, random), 1_000);
      attempt++;
      await blockFor(db, { id, seconds: delay / 1000, now: clock() }).catch(() => {});
      count("throttled");
      if (attempt > cfg.maxRetries || delay > cfg.maxSingleWaitMs || waited + delay > cfg.maxTotalWaitMs) {
        return { ok: false, kind: "throttled", retryAfter: Math.ceil(delay / 1000) };
      }
      await sleep(delay);
      waited += delay;
      continue;
    }

    if (res.status === 404) return { ok: false, kind: "not_found" };

    if (res.status >= 500 && attempt < cfg.maxRetries - 1) {
      const delay = backoffMs(attempt++, random);
      if (waited + delay <= cfg.maxTotalWaitMs) {
        await sleep(delay);
        waited += delay;
        continue;
      }
    }
    if (!res.ok) {
      count("upstream_errors");
      return { ok: false, kind: "upstream", status: res.status };
    }

    try {
      return { ok: true, json: await res.json(), status: res.status, rate };
    } catch {
      count("upstream_errors");
      return { ok: false, kind: "upstream", status: res.status };
    }
  }
}
