import { getDb } from "@/server/db";
import { coldLimiter } from "@/server/discogs/cold-limit";
import { badRequest, combineCold, guardUser, masterIdsSchema, respond } from "@/server/discogs/http";
import { getMasters } from "@/server/discogs/service";

/**
 * GET /api/discogs/masters?ids=1,2,3 (at most 12): title, year and cover of albums, for the albums step.
 * Partial answers are normal: `missing` lists ids that could not be resolved right now (see `retryAfter`).
 */
export async function GET(request: Request) {
  const ids = masterIdsSchema.safeParse(new URL(request.url).searchParams.get("ids") ?? "");
  if (!ids.success) return badRequest("Expected ids: 1 to 12 comma-separated master ids.");

  const g = await guardUser(request, "search");
  if ("response" in g) return g.response;

  const db = getDb();
  return respond(await getMasters({ db, coldLimit: combineCold(coldLimiter(db, g.userId), g.coldIp) }, ids.data));
}
