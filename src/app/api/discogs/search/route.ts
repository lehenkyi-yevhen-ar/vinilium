import { getDb } from "@/server/db";
import { badRequest, guardUser, respond, searchQuerySchema } from "@/server/discogs/http";
import { searchDiscogs } from "@/server/discogs/service";

/** GET /api/discogs/search?q=...&mode=track|artist|album&by=<artist, optional>&page=1 (vinyl releases, grouped by artist) */
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = searchQuerySchema.safeParse(params);
  if (!parsed.success) return badRequest("Expected q (1-100 chars), mode (track|artist|album), an optional by (artist) and an optional page.");

  const g = await guardUser(request, "search");
  if ("response" in g) return g.response;

  return respond(await searchDiscogs({ db: getDb(), coldLimit: g.coldIp }, { mode: parsed.data.mode, query: parsed.data.q, by: parsed.data.by, page: parsed.data.page }));
}
