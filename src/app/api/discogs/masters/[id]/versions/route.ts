import { getDb } from "@/server/db";
import { badRequest, guard, idSchema, respond, versionsQuerySchema } from "@/server/discogs/http";
import { getMasterVersions } from "@/server/discogs/service";

/** GET /api/discogs/masters/:id/versions?page=1&country=&released=&label= */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = idSchema.safeParse((await ctx.params).id);
  const query = versionsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!id.success || !query.success) return badRequest("Expected a numeric master id and optional page, country, released (year) and label.");

  const blocked = await guard(request, "search");
  if (blocked) return blocked;

  return respond(await getMasterVersions({ db: getDb() }, { masterId: id.data, page: query.data.page, filters: { country: query.data.country, label: query.data.label, released: query.data.released } }));
}
