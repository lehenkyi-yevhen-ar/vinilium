import { z } from "zod";
import { getRequestUserId, isCrossSite, originMatches } from "@/server/auth/request-user";
import { getDb } from "@/server/db";
import { errorResponse, idSchema } from "@/server/discogs/http";
import { getItem, isListName, removeItem, setItemList } from "@/server/lists/items";
import { hit } from "@/server/rate-limit";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;
const bodySchema = z.object({ list: z.string().refine(isListName) });

/** Shared checks: same-site browser request, signed in, valid id, and a modest write limit per user. */
async function gate(request: Request, ctx: { params: Promise<{ releaseId: string }> }, write: boolean) {
  if (isCrossSite(request) || (write && !originMatches(request))) {
    return { response: errorResponse(403, { error: "forbidden" }) };
  }
  const userId = await getRequestUserId(request.headers);
  if (!userId) return { response: errorResponse(401, { error: "unauthorized" }) };

  const id = idSchema.safeParse((await ctx.params).releaseId);
  if (!id.success) return { response: errorResponse(400, { error: "bad_request", message: "Expected a numeric release id." }) };

  if (write) {
    const limit = await hit(getDb(), { key: `lists:user:${userId}`, limit: 120, windowSec: 60 });
    if (!limit.allowed) return { response: errorResponse(429, { error: "rate_limited", scope: "app", retryAfter: limit.retryAfter }) };
  }
  return { userId, releaseId: id.data };
}

const body = (item: { releaseId: number; list: string; addedAt: Date } | null, extra: Record<string, unknown> = {}) =>
  Response.json({ item: item && { releaseId: item.releaseId, list: item.list, addedAt: item.addedAt.toISOString() }, ...extra }, { headers: NO_STORE });

/** GET /api/lists/items/:releaseId -> where (if anywhere) this pressing is on the signed-in user's lists. */
export async function GET(request: Request, ctx: { params: Promise<{ releaseId: string }> }) {
  const g = await gate(request, ctx, false);
  if ("response" in g) return g.response;
  return body(await getItem(getDb(), g.userId, g.releaseId));
}

/** PUT { "list": "wishlist" | "collection" }: add, or move when it is already on the other list. */
export async function PUT(request: Request, ctx: { params: Promise<{ releaseId: string }> }) {
  const g = await gate(request, ctx, true);
  if ("response" in g) return g.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, { error: "bad_request", message: 'Expected {"list":"wishlist"|"collection"}.' });

  const out = await setItemList(getDb(), g.userId, g.releaseId, parsed.data.list as "wishlist" | "collection");
  if (!out.ok) return errorResponse(409, { error: "bad_request", message: "List limit reached." });
  return body(out.item, { result: out.result });
}

/** DELETE: take the pressing off whichever list it is on. */
export async function DELETE(request: Request, ctx: { params: Promise<{ releaseId: string }> }) {
  const g = await gate(request, ctx, true);
  if ("response" in g) return g.response;
  const removed = await removeItem(getDb(), g.userId, g.releaseId);
  return body(null, { removed });
}
