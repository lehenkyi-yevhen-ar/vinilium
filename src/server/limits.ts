import "server-only";
import { serverEnv } from "@/lib/env";

/** Per-minute ceilings for our own endpoints. Defaults are generous for humans, hostile to scrapers. */
export function limits() {
  const e = serverEnv();
  return {
    windowSec: 60,
    search: { ip: e.RL_SEARCH_IP_PER_MIN ?? 30, user: e.RL_SEARCH_USER_PER_MIN ?? 60 },
    // A results page shows up to ~50 thumbnails, so images get a much larger allowance than search.
    image: { ip: e.RL_IMAGE_IP_PER_MIN ?? 300, user: e.RL_IMAGE_USER_PER_MIN ?? 600 },
  } as const;
}
