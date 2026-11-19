import { e2ePool, explainDbError } from "../helpers/e2e-db";

/** Removes the rows the Discogs e2e tests created (they live under the mock's origin), so the database stays clean. */
export default async function globalTeardown() {
  const pool = await e2ePool();
  try {
    // e2e users (their sessions, accounts and list items cascade). SAFETY: this can only match addresses the suite itself generates,
    // "e2e-<letters, digits, dashes>@example.test", under the reserved .test top-level domain that no real mailbox can have, so a
    // real person's row on the dev branch (which holds copies of real accounts) can never match. Every other statement below is
    // keyed to the mock Discogs origin (localhost:3201) or to the documentation-only IP range 203.0.113.0/24.
    // our own limiter counters of those users ("app:<scope>:user:<id>" and "app:lists:export:<id>"), before the users go: keyed to the id of a row
    // the suite created, so no real person's counter can match
    await pool.query("delete from rate_limit r using \"user\" u where u.email ~* '^e2e-[a-z0-9-]+@example\\.test$' and r.key like 'app:%:' || u.id");
    await pool.query("delete from \"user\" where email ~* '^e2e-[a-z0-9-]+@example\\.test$'");
    await pool.query("delete from discogs_cache where key like 'v%|http://localhost:3201|%'");
    await pool.query("delete from discogs_bucket where id in ('api:localhost:3201', 'img:localhost:3201')");
    // "ip:" (every request) and "ipcold:" (cold lookups) counters of the documentation-only test addresses
    await pool.query("delete from rate_limit where key like 'app:%:ip:203.0.113.%' or key like 'app:%:ipcold:203.0.113.%'");
  } catch (error) {
    // A failed cleanup must not hide the test result, so it warns; the message carries the redacted cause chain, not a bare ErrorEvent.
    console.warn("[e2e teardown] cleanup skipped:", explainDbError("teardown", error).message);
  } finally {
    await pool.end();
  }
}
