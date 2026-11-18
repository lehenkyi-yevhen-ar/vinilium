import { neonConfig } from "@neondatabase/serverless";
import { config } from "dotenv";
import { applyLocalNeonProxy } from "../../src/lib/neon-local";
import { DatabaseConfigError, resolveDatabase } from "../../src/lib/database-target";

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
    // CI only: a plain Postgres service reached through Neon's wsproxy (NEON_WS_PROXY). Inert otherwise, and never for a *.neon.tech host.
    // Every spec and the teardown get their pool after calling this function, in the same process, so the setting applies to all of them.
    applyLocalNeonProxy(neonConfig, process.env, target.url);
    return target.url;
  } catch (e) {
    if (e instanceof DatabaseConfigError) throw new Error(`e2e refuses to run: ${e.message}`);
    throw e;
  }
}
