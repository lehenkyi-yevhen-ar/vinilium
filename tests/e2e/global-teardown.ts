import { e2eDatabaseUrl } from "../helpers/e2e-db";

/** Removes the rows the Discogs e2e tests created (they live under the mock's origin), so the database stays clean. */
export default async function globalTeardown() {
  const url = e2eDatabaseUrl();
  const { Pool } = await import("@neondatabase/serverless");
  const pool = new Pool({ connectionString: url });
  try {
    // e2e users (their sessions, accounts and list items cascade). SAFETY: this can only match addresses the suite itself generates,
    // "e2e-<letters, digits, dashes>@example.test", under the reserved .test top-level domain that no real mailbox can have, so a
    // real person's row on the dev branch (which holds copies of real accounts) can never match. Every other statement below is
    // keyed to the mock Discogs origin (localhost:3201) or to the documentation-only IP range 203.0.113.0/24.
    await pool.query("delete from \"user\" where email ~* '^e2e-[a-z0-9-]+@example\\.test$'");
    await pool.query("delete from discogs_cache where key like 'v%|http://localhost:3201|%'");
    await pool.query("delete from discogs_bucket where id in ('api:localhost:3201', 'img:localhost:3201')");
    await pool.query("delete from rate_limit where key like 'app:%:ip:203.0.113.%'");
  } catch (error) {
    console.warn("[e2e teardown] cleanup skipped:", error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/g, "<redacted>") : error);
  } finally {
    await pool.end();
  }
}
