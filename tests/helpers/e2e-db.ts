import { config } from "dotenv";
import { applyLocalNeonProxy } from "../../src/lib/neon-local";
import { DatabaseConfigError, resolveDatabase } from "../../src/lib/database-target";
import { describeDbError } from "../../scripts/lib/db-error";

/**
 * The database the e2e run uses: DEV_DATABASE_URL, and nothing else. e2e creates and deletes users, sessions and cache rows,
 * so there is no fallback to DATABASE_URL (production). Without DEV_DATABASE_URL the run REFUSES to start; and if it somehow
 * points at the production server, it refuses too.
 */
export function e2eDatabaseUrl(): string {
  config({ path: ".env.local", quiet: true });
  try {
    const target = resolveDatabase({ ...process.env, NODE_ENV: "test" });
    if (target.isProduction) {
      throw new Error("e2e refuses to run: DEV_DATABASE_URL points at the same server as DATABASE_URL (production). Fix DEV_DATABASE_URL.");
    }
    return target.url;
  } catch (e) {
    if (e instanceof DatabaseConfigError) throw new Error(`e2e refuses to run: ${e.message}`);
    throw e;
  }
}

/**
 * A connection pool to the e2e database for specs, the sign-in setup and the teardown. EVERY test-side database access goes through here.
 *
 * Why one function: `@neondatabase/serverless` is a dual package (`require` gets index.js, `import()` gets index.mjs) and Playwright
 * compiles test files to CommonJS, so a static `import { neonConfig }` and a dynamic `await import(...)` give two different copies of
 * the driver. In CI the proxy setting (NEON_WS_PROXY, a plain Postgres behind Neon's wsproxy) was written to one copy while the pool was
 * built from the other, so the pool tried a real `wss://<host>/v2` and every test-side query died with a bare ErrorEvent (the e2e failure
 * of 2026-11-18). Locally nothing showed: with no proxy the setting is inert. Here the setting and the pool come from the SAME `import()`.
 * `tests/unit/e2e-db-access.test.ts` fails if a spec builds its own pool.
 */
export async function e2ePool() {
  const url = e2eDatabaseUrl();
  const neon = await import("@neondatabase/serverless");
  // CI only: inert unless NEON_WS_PROXY is set, and never for a *.neon.tech host.
  applyLocalNeonProxy(neon.neonConfig, process.env, url);
  return new neon.Pool({ connectionString: url });
}

/** A readable, redacted cause chain for a failed test-side database call (the driver reports a failed websocket as a bare ErrorEvent). */
export function explainDbError(step: string, error: unknown): Error {
  const proxied = process.env.NEON_WS_PROXY ? ` via the local proxy (${process.env.NEON_WS_PROXY})` : "";
  return new Error([`${step}: the test-side database call failed${proxied}.`, ...describeDbError(error).map((l) => `  ${l}`)].join("\n"));
}
