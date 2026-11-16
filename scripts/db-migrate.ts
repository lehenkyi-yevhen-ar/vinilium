/**
 * Apply drizzle/*.sql to the target database.
 *   npm run db:migrate                  -> the DEV database (DEV_DATABASE_URL)
 *   npm run db:migrate -- --production  -> production, only with the flag
 * Prints the target (host and database, never the password) first, and refuses production without --production.
 */
import fs from "node:fs";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { guardDatabase } from "./lib/db-guard";

async function main() {
  const target = await guardDatabase({ purpose: "Apply database migrations", allowProduction: true });
  const files = (JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: unknown[] }).entries.length;
  const pool = new Pool({ connectionString: target.url });
  const applied = async () => {
    try {
      return Number((await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0].n);
    } catch {
      return 0; // the migrations table does not exist yet
    }
  };
  try {
    const before = await applied();
    console.log(`Migrations applied before: ${before} of ${files}`);
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    const after = await applied();
    console.log(`Migrations applied now   : ${after} of ${files} (${after - before} new)`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Migration failed:", String(e?.message ?? e).replace(/postgres(ql)?:\/\/\S+/g, "<redacted>"));
  process.exit(1);
});
