import "server-only";
import { getRequestUserId, isCrossSite, originMatches } from "@/server/auth/request-user";
import { getDb } from "@/server/db";
import { errorResponse, limiterUnavailable } from "@/server/discogs/http";
import { hit, LimiterUnavailableError } from "@/server/rate-limit";

export const NO_STORE = { "Cache-Control": "private, no-store" } as const;

type Gate = { userId: string } | { response: Response };

/**
 * Checks shared by the lists endpoints: a same-site browser request (writes must also come from our own origin), a signed-in
 * user, and a per-user limit. Reads are cheap (no limiter beyond the session); writes and the export have their own budgets.
 */
export async function gateLists(
  request: Request,
  opts: { write?: boolean; limit?: { key: string; max: number; windowSec: number } } = {},
): Promise<Gate> {
  if (isCrossSite(request) || (opts.write && !originMatches(request))) return { response: errorResponse(403, { error: "forbidden" }) };
  const userId = await getRequestUserId(request.headers);
  if (!userId) return { response: errorResponse(401, { error: "unauthorized" }) };
  if (opts.limit) {
    try {
      const r = await hit(getDb(), { key: `${opts.limit.key}:${userId}`, limit: opts.limit.max, windowSec: opts.limit.windowSec });
      if (!r.allowed) return { response: errorResponse(429, { error: "rate_limited", scope: "app", retryAfter: r.retryAfter }) };
    } catch (error) {
      if (error instanceof LimiterUnavailableError) return { response: limiterUnavailable() }; // fail closed: a write or export is not let through unchecked
      throw error;
    }
  }
  return { userId };
}

export const WRITE_LIMIT = { key: "lists:user", max: 120, windowSec: 60 } as const;
