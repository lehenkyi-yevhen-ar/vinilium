import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { getDb } from "@/server/db";
import { purgeExpired } from "@/server/discogs/cache";

function authorized(request: Request): boolean {
  const secret = serverEnv().CRON_SECRET;
  if (!secret) return false; // disabled until a secret is configured
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Deletes expired Discogs cache rows and stale limiter counters. Vercel Cron calls this with the CRON_SECRET. */
export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const result = await purgeExpired(getDb());
  return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
}
