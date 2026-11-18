import "server-only";

/**
 * Lightweight counters for the Discogs budget, kept in memory per server instance and written to the log as ONE line a minute:
 *
 *   [metrics] window=60s discogs_calls=12 cache_hits=48 cache_misses=12 throttled=0 cap_hits=1 upstream_errors=0
 *
 * They count events only: no person, no IP address, no query, no Discogs content, nothing a log reader could use to identify anyone.
 * Each Vercel function instance has its own counters and its own line, and an idle instance logs nothing; add the lines of the minute
 * to get the app-wide numbers. Read them with docs/operations.md, section 19. (A restart resets the counters.)
 */

export const METRIC_NAMES = ["discogs_calls", "cache_hits", "cache_misses", "throttled", "cap_hits", "upstream_errors"] as const;
export type Metric = (typeof METRIC_NAMES)[number];

export const FLUSH_EVERY_MS = 60_000;

const counts: Record<Metric, number> = { discogs_calls: 0, cache_hits: 0, cache_misses: 0, throttled: 0, cap_hits: 0, upstream_errors: 0 };
let timer: ReturnType<typeof setInterval> | null = null;

/** Count one event. Starts the once-a-minute log line the first time it is called. */
export function count(metric: Metric, n = 1) {
  counts[metric] += n;
  if (!timer && process.env.NODE_ENV !== "test") {
    timer = setInterval(flush, FLUSH_EVERY_MS);
    timer.unref?.(); // never keeps a process alive
  }
}

/** The line for what happened since the last one, or null when nothing did. Resets the counters. */
export function takeSnapshot(): string | null {
  const total = METRIC_NAMES.reduce((sum, m) => sum + counts[m], 0);
  const line = total === 0 ? null : `[metrics] window=${FLUSH_EVERY_MS / 1000}s ${METRIC_NAMES.map((m) => `${m}=${counts[m]}`).join(" ")}`;
  for (const m of METRIC_NAMES) counts[m] = 0;
  return line;
}

export function flush() {
  const line = takeSnapshot();
  if (line) console.log(line);
}

/** For tests. */
export const peek = (): Readonly<Record<Metric, number>> => ({ ...counts });
