import { eq } from "drizzle-orm";
import { accountExportJson } from "@/lib/account/export";
import { getDb, schema } from "@/server/db";
import { errorResponse } from "@/server/discogs/http";
import { gateLists } from "@/server/lists/gate";
import { allItems } from "@/server/lists/items";

/**
 * GET /api/account/export: the signed-in person's own data (profile fields + lists) as one JSON download.
 * Same-site and sign-in only, 5 per minute, never cached.
 */
export async function GET(request: Request) {
  const g = await gateLists(request, { limit: { key: "account:export", max: 5, windowSec: 60 } });
  if ("response" in g) return g.response;

  const db = getDb();
  const [u] = await db.select().from(schema.user).where(eq(schema.user.id, g.userId)).limit(1);
  if (!u) return errorResponse(401, { error: "unauthorized" });

  const body = accountExportJson({ name: u.name, email: u.email, emailVerified: u.emailVerified, locale: (u as { locale?: string | null }).locale ?? null, createdAt: u.createdAt, image: u.image }, await allItems(db, g.userId));
  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename="vinilium-account-${new Date().toISOString().slice(0, 10)}.json"`,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
