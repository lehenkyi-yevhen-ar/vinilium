/**
 * READ-ONLY report on both databases: is each variable set, are the migrations applied, and what data is there.
 * Prints variable NAMES and counts only: no host, no connection string, no e-mail address.
 *   npm run db:status
 */
import fs from "node:fs";
import { Pool } from "@neondatabase/serverless";
import { DatabaseConfigError, parseDbUrl } from "../src/lib/database-target";
import { loadEnvFiles } from "./lib/db-guard";

loadEnvFiles();

const TABLES = ["user", "session", "account", "user_items", "discogs_cache", "discogs_bucket", "rate_limit"];
// Accounts our own tests and walkthroughs create (never a real address).
const TEST_USER = `(email like '%@example.test' or email like 'e2e+%@example.com' or email like 'ui+%@example.com')`;

async function report(label: string, name: "DEV_DATABASE_URL" | "DATABASE_URL") {
  console.log(`\n== ${label} (${name}) ==`);
  const raw = process.env[name]?.trim();
  if (!raw) return console.log("  not set");
  try {
    parseDbUrl(name, raw);
  } catch (e) {
    return console.log(`  set, but unusable: ${e instanceof DatabaseConfigError ? e.message : "invalid"}`);
  }
  console.log("  set");
  const files = (JSON.parse(fs.readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: unknown[] }).entries.length;
  const pool = new Pool({ connectionString: raw });
  const one = async (sql: string) => Number((await pool.query(sql)).rows[0].n);
  try {
    let migrations = 0;
    try {
      migrations = await one("select count(*)::int n from drizzle.__drizzle_migrations");
    } catch {
      /* no migrations table */
    }
    console.log(`  migrations applied: ${migrations} of ${files}${migrations === files ? "" : "  <-- NOT up to date"}`);
    const present = new Set((await pool.query("select table_name from information_schema.tables where table_schema = 'public'")).rows.map((r) => r.table_name));
    console.log(`  tables present: ${TABLES.filter((t) => present.has(t)).length} of ${TABLES.length}${TABLES.filter((t) => !present.has(t)).length ? ` (missing: ${TABLES.filter((t) => !present.has(t)).join(", ")})` : ""}`);
    if (present.has("user")) {
      const total = await one('select count(*)::int n from "user"');
      const test = await one(`select count(*)::int n from "user" where ${TEST_USER}`);
      console.log(`  users: ${total} (test accounts: ${test}, other accounts: ${total - test})`);
    }
    for (const t of ["user_items", "discogs_cache", "discogs_bucket", "rate_limit"]) {
      if (present.has(t)) console.log(`  ${t}: ${await one(`select count(*)::int n from ${t}`)} row(s)`);
    }
  } catch (e) {
    console.log("  could not read:", String((e as Error)?.message ?? e).replace(/postgres(ql)?:\/\/\S+/g, "<redacted>"));
  } finally {
    await pool.end().catch(() => {});
  }
}

(async () => {
  await report("DEV", "DEV_DATABASE_URL");
  await report("PRODUCTION", "DATABASE_URL");
})();
