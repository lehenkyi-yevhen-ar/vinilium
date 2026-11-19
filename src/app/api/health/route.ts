import { getDb } from "@/server/db";
import { checkHealth } from "@/server/health";

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } as const;

/**
 * GET (or HEAD) /api/health: for an uptime monitor. 200 with `{status:"ok", version, db:"up"}` when the database answers, 503 with
 * `{status:"degraded", version, db:"down"}` when it does not. No secrets, no personal data, no Discogs call. See docs/operations.md.
 */
export async function GET() {
  const health = await checkHealth(getDb());
  return Response.json(health, { status: health.db === "up" ? 200 : 503, headers: HEADERS });
}

export async function HEAD() {
  const health = await checkHealth(getDb());
  return new Response(null, { status: health.db === "up" ? 200 : 503, headers: HEADERS });
}
