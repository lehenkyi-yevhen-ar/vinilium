import { getDb } from "@/server/db";
import { badRequest, guardUser, idSchema, respond } from "@/server/discogs/http";
import { getRelease } from "@/server/discogs/service";

/** GET /api/discogs/releases/:id */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) return badRequest("Expected a numeric release id.");

  const g = await guardUser(request, "search");
  if ("response" in g) return g.response;

  return respond(await getRelease({ db: getDb(), coldLimit: g.coldIp }, id.data));
}
