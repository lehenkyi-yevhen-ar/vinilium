import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { getDb } from "@/server/db";
import { purgeRetention } from "@/server/retention";

function authorized(request: Request): boolean {
  const secret = serverEnv().CRON_SECRET;
  if (!secret) return false; // disabled until a secret is configured
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Applies the retention rules (src/server/retention.ts): expired Discogs cache rows, expired verification rows and sessions, and old
 * limiter counters. `?dryRun=1` only reports what it would delete. Vercel Cron calls this with the CRON_SECRET.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  const result = await purgeRetention(getDb(), { dryRun });
  return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
}
