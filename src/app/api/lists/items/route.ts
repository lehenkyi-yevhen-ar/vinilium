import { z } from "zod";
import { isListName, isSortKey, PAGE_SIZES } from "@/lib/lists/rules";
import { getDb } from "@/server/db";
import { badRequest } from "@/server/discogs/http";
import { gateLists, NO_STORE } from "@/server/lists/gate";
import { queryItems } from "@/server/lists/items";

const querySchema = z.object({
  list: z.string().refine(isListName),
  q: z.string().max(200).optional(),
  sort: z.string().refine(isSortKey).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).max(100_000).optional(),
  pageSize: z.coerce
    .number()
    .int()
    .refine((n) => (PAGE_SIZES as readonly number[]).includes(n))
    .optional(),
});

/**
 * GET /api/lists/items?list=wishlist|collection&q=&sort=added|notes|condition&dir=asc|desc&page=1&pageSize=12|24
 * One page of the signed-in user's stored items. Search and sort exist ONLY on stored fields (added date, notes, condition).
 * Contains no Discogs content: the screen fetches that for the visible ids only.
 */
export async function GET(request: Request) {
  const g = await gateLists(request);
  if ("response" in g) return g.response;

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return badRequest("Expected list=wishlist|collection and optional q, sort, dir, page, pageSize (12 or 24).");

  const data = await queryItems(getDb(), g.userId, parsed.data as Parameters<typeof queryItems>[2]);
  return Response.json({ data, cached: false, fetchedAt: new Date().toISOString() }, { headers: NO_STORE });
}
