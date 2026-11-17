import { toCsv, toJson } from "@/lib/lists/export";
import { getDb } from "@/server/db";
import { badRequest } from "@/server/discogs/http";
import { gateLists } from "@/server/lists/gate";
import { allItems } from "@/server/lists/items";

/**
 * GET /api/lists/export?format=csv|json: the user's own list data (release ids, list, notes, condition, dates). Never any Discogs
 * content. A download, not a page: attachment + no-store + nosniff.
 */
export async function GET(request: Request) {
  const g = await gateLists(request, { limit: { key: "lists:export", max: 10, windowSec: 60 } });
  if ("response" in g) return g.response;

  const format = new URL(request.url).searchParams.get("format") ?? "csv";
  if (format !== "csv" && format !== "json") return badRequest("Expected format=csv or format=json.");

  const items = await allItems(getDb(), g.userId);
  const stamp = new Date().toISOString().slice(0, 10);
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `attachment; filename="vinilium-lists-${stamp}.${format}"`,
    "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
  };
  // A BOM so Excel reads the UTF-8 CSV (Ukrainian, Norwegian) correctly.
  return new Response(format === "csv" ? "﻿" + toCsv(items) : toJson(items), { headers });
}
