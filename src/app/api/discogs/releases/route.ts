import { getDb } from "@/server/db";
import { badRequest, guard, releaseIdsSchema, respond } from "@/server/discogs/http";
import { getReleases } from "@/server/discogs/service";

/**
 * GET /api/discogs/releases?ids=1,2,3 (at most 24 = one list page): the card data of the visible page of a list, in ONE call.
 * Cached per release (the same entry the finder uses). Partial answers are normal: `gone` = no longer on Discogs,
 * `missing` = not resolvable right now (see `retryAfter`).
 */
export async function GET(request: Request) {
  const ids = releaseIdsSchema.safeParse(new URL(request.url).searchParams.get("ids") ?? "");
  if (!ids.success) return badRequest("Expected ids: 1 to 24 comma-separated release ids.");

  const blocked = await guard(request, "search");
  if (blocked) return blocked;

  return respond(await getReleases({ db: getDb() }, ids.data));
}
