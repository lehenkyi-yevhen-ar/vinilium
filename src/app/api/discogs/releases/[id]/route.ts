import { getDb } from "@/server/db";
import { badRequest, guard, idSchema, respond } from "@/server/discogs/http";
import { getRelease } from "@/server/discogs/service";

/** GET /api/discogs/releases/:id */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) return badRequest("Expected a numeric release id.");

  const blocked = await guard(request, "search");
  if (blocked) return blocked;

  return respond(await getRelease({ db: getDb() }, id.data));
}
