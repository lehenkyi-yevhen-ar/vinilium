import { getDb } from "@/server/db";
import { badRequest, guard, respond, searchQuerySchema } from "@/server/discogs/http";
import { searchDiscogs } from "@/server/discogs/service";

/** GET /api/discogs/search?q=...&mode=track|artist|master&page=1 */
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = searchQuerySchema.safeParse(params);
  if (!parsed.success) return badRequest("Expected q (1-100 chars), mode (track|artist|master) and an optional page.");

  const blocked = await guard(request, "search");
  if (blocked) return blocked;

  return respond(await searchDiscogs({ db: getDb() }, { mode: parsed.data.mode, query: parsed.data.q, page: parsed.data.page }));
}
