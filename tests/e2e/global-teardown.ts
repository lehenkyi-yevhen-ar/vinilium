import { e2eDatabaseUrl } from "../helpers/e2e-db";

/** Removes the rows the Discogs e2e tests created (they live under the mock's origin), so the database stays clean. */
export default async function globalTeardown() {
  const url = e2eDatabaseUrl();
  const { Pool } = await import("@neondatabase/serverless");
  const pool = new Pool({ connectionString: url });
  try {
    // e2e users (their sessions, accounts and list items cascade)
    await pool.query("delete from \"user\" where email like 'e2e-%@example.test'");
    await pool.query("delete from discogs_cache where key like 'v%|http://localhost:3201|%'");
    await pool.query("delete from discogs_bucket where id in ('api:localhost:3201', 'img:localhost:3201')");
    await pool.query("delete from rate_limit where key like 'app:%:ip:203.0.113.%'");
  } catch (error) {
    console.warn("[e2e teardown] cleanup skipped:", error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/g, "<redacted>") : error);
  } finally {
    await pool.end();
  }
}
