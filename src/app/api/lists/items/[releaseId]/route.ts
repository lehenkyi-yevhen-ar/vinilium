import { z } from "zod";
import { stripControl } from "@/lib/text";
import { CONDITIONS, isListName, NOTES_MAX, type ListName } from "@/lib/lists/rules";
import { getDb } from "@/server/db";
import { isForeignKeyViolation } from "@/server/db/errors";
import { errorResponse, idSchema } from "@/server/discogs/http";
import { gateLists, NO_STORE, WRITE_LIMIT } from "@/server/lists/gate";
import { getItem, removeItem, setItemList, updateItem } from "@/server/lists/items";

type Ctx = { params: Promise<{ releaseId: string }> };

const putSchema = z.object({ list: z.string().refine(isListName) });
const patchSchema = z
  .object({
    notes: z.string().max(NOTES_MAX * 2).transform(stripControl).nullable().optional(),
    conditionMedia: z.enum(CONDITIONS).nullable().optional(),
    conditionSleeve: z.enum(CONDITIONS).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);

async function gate(request: Request, ctx: Ctx, write: boolean) {
  const g = await gateLists(request, { write, ...(write ? { limit: WRITE_LIMIT } : {}) });
  if ("response" in g) return g;
  const id = idSchema.safeParse((await ctx.params).releaseId);
  if (!id.success) return { response: errorResponse(400, { error: "bad_request", message: "Expected a numeric release id." }) };
  return { userId: g.userId, releaseId: id.data };
}

const body = (item: { releaseId: number; list: string; addedAt: Date } | null, extra: Record<string, unknown> = {}) =>
  Response.json({ item: item && { releaseId: item.releaseId, list: item.list, addedAt: item.addedAt.toISOString() }, ...extra }, { headers: NO_STORE });

/** GET /api/lists/items/:releaseId -> where (if anywhere) this pressing is on the signed-in user's lists. */
export async function GET(request: Request, ctx: Ctx) {
  const g = await gate(request, ctx, false);
  if ("response" in g) return g.response;
  return body(await getItem(getDb(), g.userId, g.releaseId));
}

/** PUT { "list": "wishlist" | "collection" }: add, or move when it is already on the other list. */
export async function PUT(request: Request, ctx: Ctx) {
  const g = await gate(request, ctx, true);
  if ("response" in g) return g.response;

  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, { error: "bad_request", message: 'Expected {"list":"wishlist"|"collection"}.' });

  let out;
  try {
    out = await setItemList(getDb(), g.userId, g.releaseId, parsed.data.list as ListName);
  } catch (error) {
    // The person deleted their account between the session check and this write (the foreign key to "user" refused the row):
    // they are signed out now, which is what the screen shows for a 401. Anything else is a real error and propagates.
    if (isForeignKeyViolation(error)) return errorResponse(401, { error: "unauthorized" });
    throw error;
  }
  if (!out.ok) return errorResponse(409, { error: "bad_request", message: "List limit reached." });
  return body(out.item, { result: out.result });
}

/** PATCH { notes?, conditionMedia?, conditionSleeve? }: edit the user's own fields. Condition is Collection-only. */
export async function PATCH(request: Request, ctx: Ctx) {
  const g = await gate(request, ctx, true);
  if ("response" in g) return g.response;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse(400, { error: "bad_request", message: "Expected notes (text or null) and/or conditionMedia / conditionSleeve (a grade or null)." });
  }
  const out = await updateItem(getDb(), g.userId, g.releaseId, parsed.data);
  if (out.ok) return Response.json({ item: out.item }, { headers: NO_STORE });
  const status = out.error === "not_found" ? 404 : out.error === "condition_collection_only" ? 409 : 400;
  return errorResponse(status, { error: out.error === "not_found" ? "not_found" : "bad_request", message: out.error });
}

/** DELETE: take the pressing off whichever list it is on. */
export async function DELETE(request: Request, ctx: Ctx) {
  const g = await gate(request, ctx, true);
  if ("response" in g) return g.response;
  const removed = await removeItem(getDb(), g.userId, g.releaseId);
  return body(null, { removed });
}
