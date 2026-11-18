/**
 * Apply drizzle/*.sql to the target database.
 *   npm run db:migrate                  -> the DEV database (DEV_DATABASE_URL)
 *   npm run db:migrate -- --production  -> production, only with the flag
 * Prints the target (host and database, never the password) first, and refuses production without --production.
 *
 * It first proves the database is reachable (`select 1`, a few tries) and, if not, prints the WHOLE error chain (redacted) instead of the
 * "Failed query" wrapper that hides the cause. A missing migrations table is the only error treated as "nothing applied yet".
 */
import fs from "node:fs";
import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { applyLocalNeonProxy } from "../src/lib/neon-local";
import { guardDatabase } from "./lib/db-guard";
import { describeDbError, isMissingRelation } from "./lib/db-error";

const TRIES = Number(process.env.DB_CONNECT_TRIES ?? 8);
const WAIT_MS = Number(process.env.DB_CONNECT_WAIT_MS ?? 2000);

async function main() {
  const target = await guardDatabase({ purpose: "Apply database migrations", allowProduction: true });
  const files = (JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: unknown[] }).entries.length;
  const proxied = applyLocalNeonProxy(neonConfig, process.env, target.url); // CI e2e only: inert unless NEON_WS_PROXY is set, never for *.neon.tech
  if (proxied) console.log(`  transport: Neon websocket driver through the local proxy (${process.env.NEON_WS_PROXY})`);
  const pool = new Pool({ connectionString: target.url });
  // An idle-client error must not crash the process with an opaque stack; it is reported by the query that hits it.
  pool.on("error", (e: unknown) => console.error("  pool error:", describeDbError(e).join(" | ")));

  const applied = async () => {
    try {
      return Number((await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0].n);
    } catch (e) {
      if (isMissingRelation(e)) return 0; // the migrations table does not exist yet
      throw e; // anything else (a refused connection, a bad password) is NOT "0 applied"
    }
  };

  try {
    let lastError: unknown;
    for (let attempt = 1; attempt <= TRIES; attempt++) {
      try {
        await pool.query("select 1");
        lastError = undefined;
        break;
      } catch (e) {
        lastError = e;
        console.error(`  connection attempt ${attempt}/${TRIES} failed:`);
        for (const line of describeDbError(e)) console.error(`    ${line}`);
        if (attempt < TRIES) await new Promise((r) => setTimeout(r, WAIT_MS));
      }
    }
    if (lastError) {
      throw new Error(
        `Cannot reach the database (${target.source}, host ${target.host}${proxied ? ", through NEON_WS_PROXY" : ""}) after ${TRIES} tries. ` +
          (proxied
            ? "The stage that failed is printed above: a refused or reset websocket means the proxy is not running or not allowed to reach the database host; a closed socket right after connecting means the proxy cannot reach Postgres; an authentication error means the credentials in DEV_DATABASE_URL are wrong."
            : "Check the connection string and that the database is up."),
      );
    }

    const before = await applied();
    console.log(`Migrations applied before: ${before} of ${files}`);
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    const after = await applied();
    console.log(`Migrations applied now   : ${after} of ${files} (${after - before} new)`);
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error("Migration failed:");
  for (const line of describeDbError(e)) console.error(`  ${line}`);
  process.exit(1);
});
