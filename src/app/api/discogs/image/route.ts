import { getDb } from "@/server/db";
import { badRequest, errorResponse, guard } from "@/server/discogs/http";
import { proxyImage } from "@/server/discogs/image";

/**
 * GET /api/discogs/image?u=<discogs image url>
 * Streams an image from an allow-listed Discogs host. No copy is stored; see src/server/discogs/image.ts.
 */
export async function GET(request: Request) {
  const u = new URL(request.url).searchParams.get("u");
  if (!u) return badRequest("Missing u.");

  const blocked = await guard(request, "image");
  if (blocked) return blocked;

  const out = await proxyImage(u, { db: getDb() });
  if (out.ok) return out.response;
  switch (out.kind) {
    case "bad_request":
      return badRequest("That image URL is not allowed.");
    case "throttled":
      return errorResponse(429, { error: "throttled", scope: "discogs", retryAfter: out.retryAfter });
    case "not_found":
      return errorResponse(404, { error: "not_found" });
    case "unconfigured":
      return errorResponse(503, { error: "unconfigured" });
    default:
      return errorResponse(502, { error: "upstream" });
  }
}
