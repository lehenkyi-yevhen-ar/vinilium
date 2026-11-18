import "server-only";
import { serverEnv } from "@/lib/env";

/** Per-minute ceilings for our own endpoints. Defaults are generous for humans, hostile to scrapers. */
export function limits() {
  const e = serverEnv();
  return {
    windowSec: 60,
    /**
     * Search (every /api/discogs/* route except the image proxy).
     *  - `ip`: COLD requests per IP and minute, i.e. requests that need a Discogs call because the answer is not cached (default 30).
     *    This is the fairness limit people behind one address share, and the one that protects the shared Discogs budget.
     *  - `ipAll`: ALL requests per IP and minute, cached answers included (`ip` x 4 = 120). A flood ceiling that protects our own
     *    database. A browser Back, a reload or a copied link re-asks for the pages already loaded; those are answered from our
     *    cache and used to eat the 30, now they only count against this ceiling.
     *  - `user`: all requests per signed-in user and minute (default 60).
     */
    search: { ip: e.RL_SEARCH_IP_PER_MIN ?? 30, ipAll: (e.RL_SEARCH_IP_PER_MIN ?? 30) * 4, user: e.RL_SEARCH_USER_PER_MIN ?? 60 },
    // A results page shows up to ~50 thumbnails, so images get a much larger allowance than search.
    /**
     * Discogs allows ~60 requests/minute for the WHOLE app, shared by every user and instance. One cold list page costs 12 calls
     * (24 at the large page size), so 24 per person per minute lets someone cold-load two pages a minute while two such people
     * together still leave a fifth of the budget (12) for everyone else's searches. Beyond it the screen shows "Waiting for
     * Discogs" with a countdown. Cached data is free and never counts.
     */
    coldFetch: { user: e.RL_COLD_USER_PER_MIN ?? 24 },
    image: { ip: e.RL_IMAGE_IP_PER_MIN ?? 300, user: e.RL_IMAGE_USER_PER_MIN ?? 600 },
  } as const;
}
