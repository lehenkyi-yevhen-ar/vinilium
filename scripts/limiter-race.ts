/**
 * Concurrency check for our own request limiter (src/server/rate-limit.ts) against a REAL Postgres: many connections, opened beforehand, all
 * call hit() on the SAME brand-new key at the same instant, round after round. The first insert of a counter is the only moment a race can
 * happen (afterwards the row exists and updates are serialised by the row lock), so every round uses a new key.
 *
 *   npx tsx --conditions=react-server scripts/limiter-race.ts [rounds] [concurrency]
 *
 * Database: the DEV database only (DEV_DATABASE_URL; or in CI the throwaway service container through NEON_WS_PROXY). The guard refuses
 * production. It writes only keys "app:zzrace:<run>:<round>" and deletes them (and nothing else) at the end. Prints one JSON line:
 * { rounds, concurrency, failures: {<sqlstate or "other">: n}, wrongCounts, firstError } and exits 1 if anything failed.
 * `--conditions=react-server` makes the `server-only` marker import resolve to an empty module, as in scripts/discogs-smoke.ts.
 */
import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { applyLocalNeonProxy } from "../src/lib/neon-local";
import * as schema from "../src/server/db/schema";
import { hit } from "../src/server/rate-limit";
import { guardDatabase } from "./lib/db-guard";
import { describeDbError } from "./lib/db-error";

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const rounds = Number(args[0] ?? 60);
  const concurrency = Number(args[1] ?? 10);
  const target = await guardDatabase({ purpose: "Limiter concurrency check (writes and deletes its own app:zzrace: keys)", allowProduction: false });
  applyLocalNeonProxy(neonConfig, process.env, target.url);

  const pool = new Pool({ connectionString: target.url, max: concurrency });
  pool.on("error", () => {});
  const db = drizzle(pool, { schema });
  const run = Date.now().toString(36);
  const failures: Record<string, number> = {};
  let wrongCounts = 0;
  let firstError = "";

  try {
    // open every connection first: a request then goes out on an idle connection at once, instead of waiting for a handshake
    const clients = await Promise.all(Array.from({ length: concurrency }, () => pool.connect()));
    for (const c of clients) c.release();

    for (let round = 0; round < rounds; round++) {
      const key = `zzrace:${run}:${round}`;
      const settled = await Promise.allSettled(Array.from({ length: concurrency }, () => hit(db, { key, limit: 1_000_000, windowSec: 60 })));
      const counts: number[] = [];
      for (const s of settled) {
        if (s.status === "fulfilled") counts.push(s.value.count);
        else {
          const code = String((s.reason as { cause?: { code?: unknown }; code?: unknown })?.cause?.code ?? (s.reason as { code?: unknown })?.code ?? "other");
          failures[code] = (failures[code] ?? 0) + 1;
          firstError ||= describeDbError(s.reason).join(" | ").replace(/\(id\)=\(app:[^)]*\)/g, "(id)=(app:<key>)").slice(0, 400);
        }
      }
      // every call that succeeded must have seen its own distinct count (nothing lost, nothing counted twice), and the stored count must match
      const stored = (await pool.query("select count from rate_limit where key = $1", [`app:${key}`])).rows[0]?.count as number | undefined;
      const distinct = new Set(counts).size === counts.length;
      if (!distinct || (stored ?? 0) !== counts.length) wrongCounts++;
    }
  } finally {
    await pool.query("delete from rate_limit where key like $1", [`app:zzrace:${run}:%`]).catch(() => {});
    await pool.end().catch(() => {});
  }

  const failed = Object.values(failures).reduce((a, b) => a + b, 0);
  console.log(JSON.stringify({ rounds, concurrency, failedCalls: failed, failures, wrongCounts, firstError }));
  process.exit(failed > 0 || wrongCounts > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("limiter-race: could not run:", describeDbError(e).join(" | "));
  process.exit(2);
});
