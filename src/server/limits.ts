import "server-only";
import { serverEnv } from "@/lib/env";

/** Per-minute ceilings for our own endpoints. Defaults are generous for humans, hostile to scrapers. */
export function limits() {
  const e = serverEnv();
  return {
    windowSec: 60,
    search: { ip: e.RL_SEARCH_IP_PER_MIN ?? 30, user: e.RL_SEARCH_USER_PER_MIN ?? 60 },
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
