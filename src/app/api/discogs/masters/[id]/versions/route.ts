import { getDb } from "@/server/db";
import { badRequest, guard, idSchema, respond, versionsQuerySchema } from "@/server/discogs/http";
import { getMasterVersions } from "@/server/discogs/service";

/** GET /api/discogs/masters/:id/versions?page=1 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = idSchema.safeParse((await ctx.params).id);
  const query = versionsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!id.success || !query.success) return badRequest("Expected a numeric master id and an optional page.");

  const blocked = await guard(request, "search");
  if (blocked) return blocked;

  return respond(await getMasterVersions({ db: getDb() }, { masterId: id.data, page: query.data.page }));
}
